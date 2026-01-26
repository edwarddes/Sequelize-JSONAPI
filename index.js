'use strict';

const dasherize = require('dasherize');
const inflection = require('inflection');
const { Op } = require('sequelize');
const dayjs = require('dayjs');

// JSON:API Content-Type constant
const JSONAPI_CONTENT_TYPE = 'application/vnd.api+json';

// Helper function to set JSON:API Content-Type header
function setJsonApiHeaders(res) {
	res.setHeader('Content-Type', JSONAPI_CONTENT_TYPE);
}

// Helper function to deduplicate included resources by type and id
function deduplicateIncluded(includedArray) {
	const seen = new Map();
	const deduplicated = [];

	includedArray.forEach((resource) => {
		const key = `${resource.type}:${resource.id}`;
		if (!seen.has(key)) {
			seen.set(key, true);
			deduplicated.push(resource);
		}
	});

	return deduplicated;
}

// Helper function to build a resource URL from baseUrl, model, and optional id
function buildResourceUrl(baseUrl, modelName, id) {
	const path = dasherize(inflection.pluralize(modelName));
	if (id !== undefined && id !== null) {
		return `${baseUrl}/${path}/${id}`;
	}
	return `${baseUrl}/${path}`;
}

// Helper function to build relationship links
function buildRelationshipLinks(baseUrl, modelName, id, relationshipName, relatedModelName) {
	const resourceUrl = buildResourceUrl(baseUrl, modelName, id);
	return {
		self: `${resourceUrl}/relationships/${relationshipName}`,
		related: `${resourceUrl}/${relationshipName}`
	};
}

// Helper function to extract base URL from request
function getBaseUrl(req) {
	// Get the base path from the request, removing the resource-specific parts
	// For example: "/api/users/123" -> "/api"
	// When behind a reverse proxy, use X-Forwarded-Proto and X-Forwarded-Prefix headers
	// Note: Express app must have 'trust proxy' enabled for req.protocol to use X-Forwarded-Proto
	const protocol = req.protocol;
	const host = req.get('host');
	const forwardedPrefix = req.get('X-Forwarded-Prefix') || '';
	const path = forwardedPrefix || req.baseUrl || '';
	return `${protocol}://${host}${path}`;
}

// Helper function to find an association by relationship name
function findAssociationByRelationshipName(model, relationshipName) {
	const associationData = getAssociationDataForModel(model);
	let association = null;
	let associationType = null;

	// Check hasMany associations
	const hasManyMatch = associationData.hasManyAssociations.find(assoc => {
		const relName = assoc.as[0].toLowerCase() + assoc.as.substring(1);
		return relName === relationshipName;
	});

	if (hasManyMatch) {
		association = hasManyMatch;
		associationType = 'HasMany';
	}

	// Check hasOne associations
	if (!association) {
		const hasOneMatch = associationData.hasOneAssociations.find(assoc => {
			const relName = assoc.as + "Id";
			return relName === relationshipName;
		});
		if (hasOneMatch) {
			association = hasOneMatch;
			associationType = 'HasOne';
		}
	}

	// Check belongsTo associations
	if (!association) {
		const belongsToMatch = associationData.belongsToAssociations.find(assoc => {
			return assoc.foreignKey === relationshipName;
		});
		if (belongsToMatch) {
			association = belongsToMatch;
			associationType = 'BelongsTo';
		}
	}

	return { association, associationType };
}

// Helper function to format JSON:API errors
function formatJsonApiError(status, title, detail, source) {
	const error = {
		status: String(status),
		title: title
	};

	if (detail) {
		error.detail = detail;
	}

	if (source) {
		error.source = source;
	}

	return error;
}

// Helper function to send JSON:API error response
function sendJsonApiError(res, status, title, detail, source) {
	setJsonApiHeaders(res);
	res.status(status).json({
		jsonapi: { version: "1.1" },
		errors: [formatJsonApiError(status, title, detail, source)]
	});
}

// Helper function to check if a field is a date type
function isDateField(model, fieldName) {
	const attribute = model.rawAttributes[fieldName];
	if (!attribute) {
		return false;
	}

	const type = attribute.type;
	// Check if it's a DATE or DATEONLY type
	return type && (type.key === 'DATE' || type.key === 'DATEONLY');
}

// Helper function to convert Unix timestamp to Date
function convertUnixToDate(value) {
	// Check if value is a valid Unix timestamp (number or numeric string)
	if (value === null || value === undefined || value === '') {
		return value;
	}

	const timestamp = typeof value === 'string' ? parseFloat(value) : value;
	if (isNaN(timestamp)) {
		return value; // Return as-is if not a valid number
	}

	return dayjs.unix(timestamp/1000).toDate();
}

// Helper function to parse filter parameters with operators
function parseFilterParameters(filter, model) {
	const where = {};

	// Map of filter operators to Sequelize operators
	const operatorMap = {
		'gt': Op.gt,      // Greater than
		'gte': Op.gte,    // Greater than or equal
		'lt': Op.lt,      // Less than
		'lte': Op.lte,    // Less than or equal
		'ne': Op.ne,      // Not equal
		'like': Op.like,  // SQL LIKE
		'in': Op.in       // IN array
	};

	Object.keys(filter).forEach((field) => {
		const value = filter[field];
		const isDate = isDateField(model, field);

		// Check if the value is an object (contains operators)
		if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
			// Handle operator syntax: filter[field][operator]=value
			where[field] = {};

			Object.keys(value).forEach((operator) => {
				let operatorValue = value[operator];

				if (operatorMap[operator]) {
					// Convert Unix timestamp to Date for date fields
					if (isDate && operator !== 'in') {
						operatorValue = convertUnixToDate(operatorValue);
					}

					// Convert comma-separated values to array for 'in' operator
					if (operator === 'in' && typeof operatorValue === 'string') {
						const values = operatorValue.split(',');
						// Convert each value if it's a date field
						where[field][operatorMap[operator]] = isDate
							? values.map(convertUnixToDate)
							: values;
					} else {
						where[field][operatorMap[operator]] = operatorValue;
					}
				} else {
					// Unknown operator, treat as nested field (maintain backward compatibility)
					where[field] = value;
				}
			});
		} else {
			// Simple equality filter: filter[field]=value
			where[field] = isDate ? convertUnixToDate(value) : value;
		}
	});

	return where;
}

// Middleware to validate Content-Type header on requests with body
function validateContentType(req, res, next) {
	// Only validate for requests with a body (POST, PATCH)
	if (req.method === 'POST' || req.method === 'PATCH') {
		const contentType = req.get('Content-Type');

		// Check if Content-Type header exists
		if (!contentType) {
			return sendJsonApiError(
				res,
				400,
				'Missing Content-Type',
				'Content-Type header is required for requests with a body'
			);
		}

		// Check if Content-Type matches JSON:API spec
		// Must be exactly 'application/vnd.api+json' with no media type parameters
		if (contentType !== JSONAPI_CONTENT_TYPE) {
			// If it has the base type but with parameters, that's a 415 error
			if (contentType.startsWith(JSONAPI_CONTENT_TYPE + ';') || contentType.startsWith(JSONAPI_CONTENT_TYPE + ' ')) {
				return sendJsonApiError(
					res,
					415,
					'Unsupported Media Type',
					'Content-Type header must be application/vnd.api+json without media type parameters'
				);
			}

			// Otherwise it's the wrong content type
			return sendJsonApiError(
				res,
				415,
				'Unsupported Media Type',
				`Content-Type must be ${JSONAPI_CONTENT_TYPE}`,
				{ header: 'Content-Type' }
			);
		}
	}

	next();
}

class jsonapi
{
	static createRoutesForModel(router, model)
	{
		const modelNameForRoute = dasherize(inflection.pluralize(model.name));

		// Apply Content-Type validation middleware to all routes
		router.use('/' + modelNameForRoute, validateContentType);
		router.use('/' + modelNameForRoute + '/:id', validateContentType);

		router.get('/' + modelNameForRoute, jsonapi.GetList(model));
		router.get('/' + modelNameForRoute + '/:id', jsonapi.GetSingle(model));
		router.patch('/' + modelNameForRoute + '/:id', jsonapi.Update(model));
		router.delete('/' + modelNameForRoute + '/:id', jsonapi.Delete(model));
		router.post('/' + modelNameForRoute, jsonapi.Create(model));

		// Relationship endpoints - must come before related resource endpoint to match /relationships/ first
		router.get('/' + modelNameForRoute + '/:id/relationships/:relationship', jsonapi.GetRelationship(model));
		router.patch('/' + modelNameForRoute + '/:id/relationships/:relationship', jsonapi.UpdateRelationship(model));

		// Related resource endpoint - must come after GetSingle and relationship endpoints
		router.get('/' + modelNameForRoute + '/:id/:relationship', jsonapi.GetRelated(model));
	}

	// Export middleware for manual use
	static get contentTypeMiddleware() {
		return validateContentType;
	}

	static Create(model)
	{
		return async function(req, res, next)
		{
			try {
				// Validate request body structure
				if (!req.body || !req.body.data) {
					return sendJsonApiError(
						res,
						400,
						'Invalid Request',
						'Request body must contain a "data" object',
						{ pointer: '/data' }
					);
				}

				if (!req.body.data.attributes) {
					return sendJsonApiError(
						res,
						400,
						'Invalid Request',
						'Request body must contain "data.attributes"',
						{ pointer: '/data/attributes' }
					);
				}

				const attributes = req.body.data.attributes;
				const relationships = req.body.data.relationships;

				const jsonAPIObject = {
					data: {}
				};

				const relationshipsData = relationships || {};

				const associationData = getAssociationDataForModel(model);
				associationData.belongsToAssociations.forEach((belongsTo) =>
				{
					const relationship = relationshipsData[belongsTo.foreignKey];
					if (relationship !== null && relationship !== undefined)
					{
						if (relationship.data !== null && relationship.data !== undefined)
						{
							attributes[belongsTo.foreignKey] = relationship.data.id;
						}
						else
						{
							attributes[belongsTo.foreignKey] = null;
						}
					}
				});

				const row = await model.create(attributes);
				const resourceId = row.get('id');

				// Build full resource object with attributes (like PATCH does)
				// Reuse associationData from above
				const includes = [];
				associationData.hasManyAssociations.forEach((association) => {
					includes.push({
						model: association.target,
						as: association.as,
						separate: true
					});
				});
				associationData.hasOneAssociations.forEach((association) => {
					includes.push({
						model: association.target,
						as: association.as
					});
				});
				associationData.belongsToAssociations.forEach((association) => {
					includes.push({
						model: association.target,
						as: association.as
					});
				});

				// Fetch the newly created resource with associations
				const object = await fetchAndBuildResourceObjectForModelById(
					model,
					resourceId,
					{ include: includes },
					false,
					getBaseUrl(req)
				);

				jsonAPIObject.data = object.resourceObject;

				// Add included member if there are related resources
				if (object.included && object.included.length > 0) {
					jsonAPIObject.included = object.included;
				}

				// Add top-level self link pointing to the newly created resource
				const baseUrl = getBaseUrl(req);
				jsonAPIObject.links = {
					self: buildResourceUrl(baseUrl, model.name, resourceId)
				};

				// Add jsonapi version member
				jsonAPIObject.jsonapi = { version: "1.1" };

				setJsonApiHeaders(res);
				res.status(201).json(jsonAPIObject);
			} catch (error) {
				// Format Sequelize validation errors
				if (error.name === 'SequelizeValidationError') {
					const errors = error.errors.map((err) => formatJsonApiError(
						422,
						'Validation Error',
						err.message,
						{ pointer: `/data/attributes/${err.path}` }
					));
					setJsonApiHeaders(res);
					return res.status(422).json({
						jsonapi: { version: "1.1" },
						errors
					});
				}

				// Format other database errors
				if (error.name === 'SequelizeDatabaseError') {
					return sendJsonApiError(
						res,
						500,
						'Database Error',
						'An error occurred while processing your request'
					);
				}

				// Pass other errors to error handler
				next(error);
			}
		};
	}

	static Delete(model)
	{
		return async function(req, res, next)
		{
			try {
				const options = req.options || {};

				options.where = options.where || {};
				options.where[model.primaryKeyAttribute] = req.params.id;

				const instance = await model.findOne(options);

				if (!instance)
				{
					return sendJsonApiError(
						res,
						404,
						'Resource Not Found',
						`${model.name} with id ${req.params.id} not found`
					);
				}

				await instance.destroy();
				setJsonApiHeaders(res);
				res.status(204).end();
			} catch (error) {
				if (error.name === 'SequelizeDatabaseError') {
					return sendJsonApiError(
						res,
						500,
						'Database Error',
						'An error occurred while deleting the resource'
					);
				}
				next(error);
			}
		};
	}

	static GetSingle(model)
	{
		return async function(req, res, next)
		{
			try {
				const options = req.options || {};
				options.where = options.where || {};

				const jsonAPIObject = {
					data: null
				};

				const simple = req.query.simple || false;
				const baseUrl = getBaseUrl(req);

				if (!simple)
				{
					const associationData = getAssociationDataForModel(model);
					const includes = [];
					associationData.hasManyAssociations.forEach((association) =>
					{
						includes.push({
							model: association.target,
							as: association.as,
							separate: true
						});
					});
					associationData.hasOneAssociations.forEach((association) =>
					{
						includes.push({
							model: association.target,
							as: association.as
						});
					});
					associationData.belongsToAssociations.forEach((association) =>
					{
						includes.push({
							model: association.target,
							as: association.as
						});
					});
					options.include = includes;
				}

				const object = await fetchAndBuildResourceObjectForModelById(
					model,
					req.params.id,
					options,
					simple,
					simple ? null : baseUrl
				);

				if (object === null)
				{
					return sendJsonApiError(
						res,
						404,
						'Resource Not Found',
						`${model.name} with id ${req.params.id} not found`
					);
				}

				jsonAPIObject.data = object.resourceObject;

				// Add included member if there are related resources (deduplicated)
				// if (object.included && object.included.length > 0) {
				// 	jsonAPIObject.included = deduplicateIncluded(object.included);
				// }

				// Add top-level self link
				if (!simple) {
					jsonAPIObject.links = {
						self: buildResourceUrl(baseUrl, model.name, req.params.id)
					};
				}

				// Add jsonapi version member
				jsonAPIObject.jsonapi = { version: "1.1" };

				setJsonApiHeaders(res);
				res.json(jsonAPIObject);
			} catch (error) {
				if (error.name === 'SequelizeDatabaseError') {
					return sendJsonApiError(
						res,
						500,
						'Database Error',
						'An error occurred while fetching the resource'
					);
				}
				next(error);
			}
		};
	}

	static GetList(model)
	{
		return async function(req, res, next)
		{
			try {
				const options = req.options || {};
				options.where = options.where || {};
				const baseUrl = getBaseUrl(req);

				let idList = null;
				let filter = null;
				if (req.query.filter !== undefined && req.query.filter.id !== undefined)
				{
					// Check if id filter uses operators or is a simple comma-separated list
					if (typeof req.query.filter.id === 'object' && !Array.isArray(req.query.filter.id)) {
						// ID filter with operators like filter[id][gt]=5
						filter = req.query.filter;
					} else {
						// Simple comma-separated ID list: filter[id]=1,2,3
						idList = req.query.filter.id.split(',');
					}
				}

				// Other filter parameters
				if (req.query.filter !== undefined && req.query.filter.id === undefined)
				{
					filter = req.query.filter;
				}

				const jsonAPIObject = {
					data: []
				};

				// Check if include parameter is present - if so, we need to load relationships
				const hasIncludeParam = req.query.include !== undefined;

				// Fetching list of all of model
				if (idList === null && filter === null && !hasIncludeParam)
				{
					const instances = await model.findAll(options);

					if (instances)
					{
						instances.forEach((instance) =>
						{
							jsonAPIObject.data.push(buildResourceObjectForInstance(instance, model, true, null).resourceObject);
						});
					}

					// Add top-level self link
					jsonAPIObject.links = {
						self: buildResourceUrl(baseUrl, model.name)
					};

					// Add jsonapi version member
					jsonAPIObject.jsonapi = { version: "1.1" };

					setJsonApiHeaders(res);
					res.json(jsonAPIObject);
				}
				// Fetching specific instances of model coalesced
				else
				{
					const associationData = getAssociationDataForModel(model);

					const includes = [];
					associationData.hasManyAssociations.forEach((association) =>
					{
						includes.push({
							model: association.target,
							as: association.as,
							separate: true
						});
					});
					associationData.hasOneAssociations.forEach((association) =>
					{
						includes.push({
							model: association.target,
							as: association.as
						});
					});
					associationData.belongsToAssociations.forEach((association) =>
					{
						includes.push({
							model: association.target,
							as: association.as
						});
					});
					options.include = includes;

					if (idList !== null)
					{
						options.where = {id: idList};
					}
					else if (filter !== null)
					{
						options.where = parseFilterParameters(filter, model);
					}

					const instances = await model.findAll(options);

					const allIncluded = [];

					if (instances)
					{
						instances.forEach((instance) =>
						{
							if (instance === null)
							{
								res.status(404).end();
							}
							else
							{
								const result = buildResourceObjectForInstance(instance, model, false, baseUrl);
								jsonAPIObject.data.push(result.resourceObject);

								// Collect included resources from all instances
								if (result.included && result.included.length > 0) {
									allIncluded.push(...result.included);
								}
							}
						});
					}

					// Add included member if there are related resources (deduplicated)
					// if (allIncluded.length > 0) {
					// 	jsonAPIObject.included = deduplicateIncluded(allIncluded);
					// }

					// Add top-level self link with query parameters
					const queryString = req.url.substring(req.url.indexOf('?'));
					jsonAPIObject.links = {
						self: `${buildResourceUrl(baseUrl, model.name)}${queryString}`
					};

					// Add jsonapi version member
					jsonAPIObject.jsonapi = { version: "1.1" };

					setJsonApiHeaders(res);
					res.json(jsonAPIObject);
				}
			} catch (error) {
				if (error.name === 'SequelizeDatabaseError') {
					return sendJsonApiError(
						res,
						500,
						'Database Error',
						'An error occurred while fetching resources'
					);
				}
				next(error);
			}
		};
	}

	static GetRelated(model)
	{
		return async function(req, res, next)
		{
			try {
				const parentId = req.params.id;
				const relationshipName = req.params.relationship;
				const baseUrl = getBaseUrl(req);

				// Find the association
				const { association, associationType } = findAssociationByRelationshipName(model, relationshipName);

				if (!association) {
					// Relationship not found - pass to next middleware instead of returning error
					return next();
				}
				// Verify parent resource exists
				const parentInstance = await model.findByPk(parentId);
				if (!parentInstance) {
					return sendJsonApiError(
						res,
						404,
						'Resource Not Found',
						`${model.name} with id ${parentId} not found`
					);
				}

				// Get association data for the target model to include nested relationships
				const targetAssociationData = getAssociationDataForModel(association.target);
				const includes = [];
				targetAssociationData.hasManyAssociations.forEach((targetAssoc) => {
					includes.push({
						model: targetAssoc.target,
						as: targetAssoc.as,
						separate: true
					});
				});
				targetAssociationData.hasOneAssociations.forEach((targetAssoc) => {
					includes.push({
						model: targetAssoc.target,
						as: targetAssoc.as
					});
				});

				const jsonAPIObject = {
					data: null
				};

				// Fetch related resources based on association type
				if (associationType === 'HasMany') {
					const relatedInstances = await association.target.findAll({
						where: {
							[association.foreignKey]: parentId
						},
						include: includes
					});

					const allIncluded = [];
					jsonAPIObject.data = relatedInstances.map(instance => {
						const result = buildResourceObjectForInstance(instance, association.target, false, baseUrl);
						if (result.included && result.included.length > 0) {
							allIncluded.push(...result.included);
						}
						return result.resourceObject;
					});

					// Add included member if there are related resources (deduplicated)
					// if (allIncluded.length > 0) {
					// 	jsonAPIObject.included = deduplicateIncluded(allIncluded);
					// }

					jsonAPIObject.links = {
						self: `${buildResourceUrl(baseUrl, model.name, parentId)}/${relationshipName}`
					};

				} else if (associationType === 'HasOne' || associationType === 'BelongsTo') {
					let relatedInstance = null;

					if (associationType === 'HasOne') {
						relatedInstance = await association.target.findOne({
							where: {
								[association.foreignKey]: parentId
							},
							include: includes
						});
					} else { // BelongsTo
						const foreignKeyValue = parentInstance.get(association.foreignKey);
						if (foreignKeyValue) {
							relatedInstance = await association.target.findByPk(foreignKeyValue, {
								include: includes
							});
						}
					}

					if (relatedInstance) {
						const result = buildResourceObjectForInstance(relatedInstance, association.target, false, baseUrl);
						jsonAPIObject.data = result.resourceObject;

						// Add included member if there are related resources (deduplicated)
						// if (result.included && result.included.length > 0) {
						// 	jsonAPIObject.included = deduplicateIncluded(result.included);
						// }
					}

					jsonAPIObject.links = {
						self: `${buildResourceUrl(baseUrl, model.name, parentId)}/${relationshipName}`
					};
				}

				// Add jsonapi version member
				jsonAPIObject.jsonapi = { version: "1.1" };

				setJsonApiHeaders(res);
				res.json(jsonAPIObject);
			} catch (error) {
				if (error.name === 'SequelizeDatabaseError') {
					return sendJsonApiError(
						res,
						500,
						'Database Error',
						'An error occurred while fetching related resources'
					);
				}
				next(error);
			}
		};
	}

	static Update(model)
	{
		return async function(req, res, next)
		{
			try {
				// Validate request body structure
				if (!req.body || !req.body.data) {
					return sendJsonApiError(
						res,
						400,
						'Invalid Request',
						'Request body must contain a "data" object',
						{ pointer: '/data' }
					);
				}

				if (!req.body.data.attributes) {
					return sendJsonApiError(
						res,
						400,
						'Invalid Request',
						'Request body must contain "data.attributes"',
						{ pointer: '/data/attributes' }
					);
				}

				const body = req.body;
				const options = req.options || {};

				options.where = options.where || {};
				options.where[model.primaryKeyAttribute] = req.params.id;

				const associationData = getAssociationDataForModel(model);

				const attributes = body.data.attributes;
				const relationships = body.data.relationships;

				const row = await model.findOne(options);

				if (!row)
				{
					return sendJsonApiError(
						res,
						404,
						'Resource Not Found',
						`${model.name} with id ${req.params.id} not found`
					);
				}

				// If the column is an integer column it needs null for a blank value not ''
				// This doesn't hurt string columns, at least in my cases
				Object.keys(attributes).forEach((key) =>
				{
					if (attributes[key] === '')
					{
						attributes[key] = null;
					}
				});

				associationData.belongsToAssociations.forEach((belongsTo) =>
				{
					if (relationships && belongsTo.foreignKey !== undefined)
					{
						const relationship = relationships[belongsTo.foreignKey];
						if (relationship !== undefined) {
							if (relationship.data !== null && relationship.data !== undefined)
							{
								attributes[belongsTo.foreignKey] = relationship.data.id;
							}
							else
							{
								attributes[belongsTo.foreignKey] = null;
							}
						}
					}
				});

				await row.update(attributes);

				const jsonAPIObject = {
					data: null
				};

				const includes = [];
				associationData.hasManyAssociations.forEach((association) =>
				{
					includes.push({
						model: association.target,
						as: association.as,
						separate: true
					});
				});
				associationData.hasOneAssociations.forEach((association) =>
				{
					includes.push({
						model: association.target,
						as: association.as
					});
				});
				associationData.belongsToAssociations.forEach((association) =>
				{
					includes.push({
						model: association.target,
						as: association.as
					});
				});
				options.include = includes;

				const baseUrl = getBaseUrl(req);
				const object = await fetchAndBuildResourceObjectForModelById(
					model,
					req.params.id,
					options,
					false,
					baseUrl
				);

				if (object === null)
				{
					return sendJsonApiError(
						res,
						404,
						'Resource Not Found',
						`${model.name} with id ${req.params.id} not found`
					);
				}

				jsonAPIObject.data = object.resourceObject;

				// Add included member if there are related resources (deduplicated)
				// if (object.included && object.included.length > 0) {
				// 	jsonAPIObject.included = deduplicateIncluded(object.included);
				// }

				// Add top-level self link
				jsonAPIObject.links = {
					self: buildResourceUrl(baseUrl, model.name, req.params.id)
				};

				// Add jsonapi version member
				jsonAPIObject.jsonapi = { version: "1.1" };

				setJsonApiHeaders(res);
				res.json(jsonAPIObject);
			} catch (error) {
				// Format Sequelize validation errors
				if (error.name === 'SequelizeValidationError') {
					const errors = error.errors.map((err) => formatJsonApiError(
						422,
						'Validation Error',
						err.message,
						{ pointer: `/data/attributes/${err.path}` }
					));
					setJsonApiHeaders(res);
					return res.status(422).json({
						jsonapi: { version: "1.1" },
						errors
					});
				}

				if (error.name === 'SequelizeDatabaseError') {
					return sendJsonApiError(
						res,
						500,
						'Database Error',
						'An error occurred while updating the resource'
					);
				}

				next(error);
			}
		};
	}

	static GetRelationship(model)
	{
		return async function(req, res, next)
		{
			try {
				const parentId = req.params.id;
				const relationshipName = req.params.relationship;
				const baseUrl = getBaseUrl(req);

				// Find the association
				const { association, associationType } = findAssociationByRelationshipName(model, relationshipName);

				if (!association) {
					return sendJsonApiError(
						res,
						404,
						'Relationship Not Found',
						`Relationship '${relationshipName}' not found on ${model.name}`
					);
				}

				// Verify parent resource exists
				const parentInstance = await model.findByPk(parentId);
				if (!parentInstance) {
					return sendJsonApiError(
						res,
						404,
						'Resource Not Found',
						`${model.name} with id ${parentId} not found`
					);
				}

				const jsonAPIObject = {
					data: null,
					links: {
						self: `${buildResourceUrl(baseUrl, model.name, parentId)}/relationships/${relationshipName}`,
						related: `${buildResourceUrl(baseUrl, model.name, parentId)}/${relationshipName}`
					}
				};

				// Fetch relationship data based on association type
				if (associationType === 'HasMany') {
					const relatedInstances = await association.target.findAll({
						where: {
							[association.foreignKey]: parentId
						}
					});

					jsonAPIObject.data = relatedInstances.map(instance =>
						buildResourceIdentifierObject(instance.constructor.name, instance.get('id'))
					);

				} else if (associationType === 'HasOne') {
					const relatedInstance = await association.target.findOne({
						where: {
							[association.foreignKey]: parentId
						}
					});

					if (relatedInstance) {
						jsonAPIObject.data = buildResourceIdentifierObject(
							relatedInstance.constructor.name,
							relatedInstance.get('id')
						);
					}

				} else if (associationType === 'BelongsTo') {
					const foreignKeyValue = parentInstance.get(association.foreignKey);
					if (foreignKeyValue) {
						const relatedInstance = await association.target.findByPk(foreignKeyValue);
						if (relatedInstance) {
							jsonAPIObject.data = buildResourceIdentifierObject(
								relatedInstance.constructor.name,
								relatedInstance.get('id')
							);
						}
					}
				}

				// Add jsonapi version member
				jsonAPIObject.jsonapi = { version: "1.1" };

				setJsonApiHeaders(res);
				res.json(jsonAPIObject);
			} catch (error) {
				if (error.name === 'SequelizeDatabaseError') {
					return sendJsonApiError(
						res,
						500,
						'Database Error',
						'An error occurred while fetching the relationship'
					);
				}
				next(error);
			}
		};
	}

	static UpdateRelationship(model)
	{
		return async function(req, res, next)
		{
			try {
				const parentId = req.params.id;
				const relationshipName = req.params.relationship;
				const baseUrl = getBaseUrl(req);

				// Validate request body
				if (!req.body || req.body.data === undefined) {
					return sendJsonApiError(
						res,
						400,
						'Invalid Request',
						'Request body must contain a "data" member',
						{ pointer: '/data' }
					);
				}

				// Find the association
				const { association, associationType } = findAssociationByRelationshipName(model, relationshipName);

				if (!association) {
					return sendJsonApiError(
						res,
						404,
						'Relationship Not Found',
						`Relationship '${relationshipName}' not found on ${model.name}`
					);
				}

				// Verify parent resource exists
				const parentInstance = await model.findByPk(parentId);
				if (!parentInstance) {
					return sendJsonApiError(
						res,
						404,
						'Resource Not Found',
						`${model.name} with id ${parentId} not found`
					);
				}

				// Update relationship based on type
				if (associationType === 'HasMany') {
					// For HasMany, data should be an array of resource identifiers
					if (!Array.isArray(req.body.data)) {
						return sendJsonApiError(
							res,
							400,
							'Invalid Request',
							'For to-many relationships, data must be an array',
							{ pointer: '/data' }
						);
					}

					// Full replacement - remove all existing relationships and add new ones
					const relatedIds = req.body.data.map(identifier => identifier.id);

					// Remove all existing relationships
					await association.target.update(
						{ [association.foreignKey]: null },
						{ where: { [association.foreignKey]: parentId } }
					);

					// Add new relationships
					if (relatedIds.length > 0) {
						await association.target.update(
							{ [association.foreignKey]: parentId },
							{ where: { id: relatedIds } }
						);
					}

				} else if (associationType === 'HasOne' || associationType === 'BelongsTo') {
					// For to-one relationships, data should be a single resource identifier or null
					if (req.body.data !== null && (Array.isArray(req.body.data) || typeof req.body.data !== 'object')) {
						return sendJsonApiError(
							res,
							400,
							'Invalid Request',
							'For to-one relationships, data must be a resource identifier object or null',
							{ pointer: '/data' }
						);
					}

					if (associationType === 'BelongsTo') {
						// Update the foreign key on the parent resource
						const newValue = req.body.data ? req.body.data.id : null;
						await parentInstance.update({ [association.foreignKey]: newValue });
					} else {
						// HasOne - update the foreign key on the related resource
						// First, clear any existing relationship
						await association.target.update(
							{ [association.foreignKey]: null },
							{ where: { [association.foreignKey]: parentId } }
						);

						// Then set the new relationship if provided
						if (req.body.data) {
							await association.target.update(
								{ [association.foreignKey]: parentId },
								{ where: { id: req.body.data.id } }
							);
						}
					}
				}

				// Return the updated relationship data
				const jsonAPIObject = {
					data: null,
					links: {
						self: `${buildResourceUrl(baseUrl, model.name, parentId)}/relationships/${relationshipName}`,
						related: `${buildResourceUrl(baseUrl, model.name, parentId)}/${relationshipName}`
					}
				};

				// Fetch the updated relationship data
				if (associationType === 'HasMany') {
					const relatedInstances = await association.target.findAll({
						where: {
							[association.foreignKey]: parentId
						}
					});

					jsonAPIObject.data = relatedInstances.map(instance =>
						buildResourceIdentifierObject(instance.constructor.name, instance.get('id'))
					);

				} else if (associationType === 'HasOne') {
					const relatedInstance = await association.target.findOne({
						where: {
							[association.foreignKey]: parentId
						}
					});

					if (relatedInstance) {
						jsonAPIObject.data = buildResourceIdentifierObject(
							relatedInstance.constructor.name,
							relatedInstance.get('id')
						);
					}

				} else if (associationType === 'BelongsTo') {
					// Reload the parent instance to get the updated foreign key
					await parentInstance.reload();
					const foreignKeyValue = parentInstance.get(association.foreignKey);
					if (foreignKeyValue) {
						const relatedInstance = await association.target.findByPk(foreignKeyValue);
						if (relatedInstance) {
							jsonAPIObject.data = buildResourceIdentifierObject(
								relatedInstance.constructor.name,
								relatedInstance.get('id')
							);
						}
					}
				}

				// Add jsonapi version member
				jsonAPIObject.jsonapi = { version: "1.1" };

				setJsonApiHeaders(res);
				res.status(200).json(jsonAPIObject);
			} catch (error) {
				if (error.name === 'SequelizeDatabaseError') {
					return sendJsonApiError(
						res,
						500,
						'Database Error',
						'An error occurred while updating the relationship'
					);
				}
				next(error);
			}
		};
	}
}

async function fetchAndBuildResourceObjectForModelById(model, id, options, simple, baseUrl)
{
	const instance = await model.findByPk(id, options);
	return buildResourceObjectForInstance(instance, model, simple, baseUrl);
}

function buildResourceObjectForInstance(instance, model, simple, baseUrl)
{
	if (instance)
	{
		const rowValues = instance.get();

		const relationships = {};
		const included = [];

		const associationData = getAssociationDataForModel(model);
		const resourceObject = buildSimpleResourceObject(instance, associationData.excludedKeys);

		// Controls including the included and relationships
		if (!simple)
		{
			associationData.hasManyAssociations.forEach((associationKey) =>
			{
				const relationship = {};

				const entities = rowValues[associationKey.as];
				const relationshipValues = [];
				if (entities)
				{
					entities.forEach((entity) =>
					{
						const entityRowValues = entity.get();
						relationshipValues.push(buildResourceIdentifierObject(entity.constructor.name, entityRowValues.id));

						// Recursively build resource object for included entities with their relationships
						const entityResult = buildResourceObjectForInstance(entity, associationKey.target, false, baseUrl);
						if (entityResult) {
							included.push(entityResult.resourceObject);
							// Collect nested included resources
							if (entityResult.included && entityResult.included.length > 0) {
								included.push(...entityResult.included);
							}
						}
					});
				}
				relationship.data = relationshipValues;

				// Add relationship links if baseUrl is provided
				if (baseUrl) {
					const relationshipName = associationKey.as[0].toLowerCase() + associationKey.as.substring(1);
					relationship.links = buildRelationshipLinks(
						baseUrl,
						model.name,
						rowValues.id,
						relationshipName,
						associationKey.target.name
					);
				}

				relationships[associationKey.as[0].toLowerCase() + associationKey.as.substring(1)] = relationship;
			});

			associationData.hasOneAssociations.forEach((associationKey) =>
			{
				const relationship = {};
				if (rowValues[associationKey.as] !== null && rowValues[associationKey.as] !== undefined)
				{
					relationship.data = buildResourceIdentifierObject(
						rowValues[associationKey.as].constructor.name,
						rowValues[associationKey.as].id);

					// Recursively build resource object for included entity with its relationships
					const entityResult = buildResourceObjectForInstance(rowValues[associationKey.as], associationKey.target, false, baseUrl);
					if (entityResult) {
						included.push(entityResult.resourceObject);
						// Collect nested included resources
						if (entityResult.included && entityResult.included.length > 0) {
							included.push(...entityResult.included);
						}
					}
				}
				else
				{
					relationship.data = null;
				}

				// Add relationship links if baseUrl is provided
				if (baseUrl) {
					const relationshipName = associationKey.as + "Id";
					relationship.links = buildRelationshipLinks(
						baseUrl,
						model.name,
						rowValues.id,
						relationshipName,
						associationKey.target.name
					);
				}

				relationships[associationKey.as + "Id"] = relationship;
			});

			associationData.belongsToAssociations.forEach((associationKey) =>
			{
				const relationship = {};

				if (rowValues[associationKey.foreignKey] !== null && rowValues[associationKey.foreignKey] !== undefined)
				{
					relationship.data = buildResourceIdentifierObject(
						associationKey.target.options.name.singular,
						rowValues[associationKey.foreignKey]);
				}
				else
				{
					relationship.data = null;
				}

				// Add relationship links if baseUrl is provided
				if (baseUrl) {
					relationship.links = buildRelationshipLinks(
						baseUrl,
						model.name,
						rowValues.id,
						associationKey.foreignKey,
						associationKey.target.name
					);
				}

				relationships[associationKey.foreignKey] = relationship;
			});

			resourceObject.relationships = relationships;
		}

		return {resourceObject: resourceObject, included: included};
	}
	else
	{
		return null;
	}
}

function getAssociationDataForModel(model)
{
	const associations = model.associations;

	const associationData = {
		hasManyAssociations: [],
		hasOneAssociations: [],
		belongsToAssociations: [],
		excludedKeys: []
	};

	Object.keys(associations).forEach((associationKey) =>
	{
		const associationType = associations[associationKey].associationType;
		if (associationType === "HasMany")
		{
			associationData.hasManyAssociations.push(associations[associationKey]);
			associationData.excludedKeys.push(associations[associationKey].as);
		}
		if (associationType === "HasOne")
		{
			associationData.hasOneAssociations.push(associations[associationKey]);
			associationData.excludedKeys.push(associations[associationKey].as);
		}
		if (associationType === "BelongsTo")
		{
			associationData.excludedKeys.push(associations[associationKey].foreignKey);
			associationData.excludedKeys.push(associations[associationKey].as);
			associationData.belongsToAssociations.push(associations[associationKey]);
		}
	});

	return associationData;
}

// Includes type, id, and attributes for the instance
function buildSimpleResourceObject(instance, excludedAttributes)
{
	const rowValues = instance.get();

	// Get the model name - Sequelize 6 structure
	const modelName = instance.constructor.name;

	const resourceObject = {
		id: String(rowValues.id), // Convert to string per JSON:API spec
		type: modelName,
		attributes: {}
	};

	Object.keys(instance.dataValues).forEach((key) =>
	{
		if (key !== "id" && !excludedAttributes.includes(key))
		{
			resourceObject.attributes[key] = rowValues[key];
		}
	});

	return resourceObject;
}

// Includes only type and id
function buildResourceIdentifierObject(modelName, id)
{
	return {
		id: String(id), // Convert to string per JSON:API spec
		type: modelName
	};
}

module.exports = jsonapi;