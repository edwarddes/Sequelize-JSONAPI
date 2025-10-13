'use strict';

const dasherize = require('dasherize');
const inflection = require('inflection');

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
		errors: [formatJsonApiError(status, title, detail, source)]
	});
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
		if (contentType !== JSONAPI_CONTENT_TYPE && !contentType.startsWith(JSONAPI_CONTENT_TYPE + ';')) {
			// If it has the base type but with parameters, that's a 415 error
			if (contentType.startsWith(JSONAPI_CONTENT_TYPE)) {
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
				jsonAPIObject.data = buildResourceIdentifierObject(model.name, row.get('id'));

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
					return res.status(422).json({ errors });
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
				res.sendStatus(204);
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
				if (!simple)
				{
					const associationData = getAssociationDataForModel(model);
					const includes = [];
					associationData.hasManyAssociations.forEach((association) =>
					{
						includes.push({
							model: association.target,
							separate: true
						});
					});
					associationData.hasOneAssociations.forEach((association) =>
					{
						includes.push({
							model: association.target
						});
					});
					options.include = includes;
				}

				const object = await fetchAndBuildResourceObjectForModelById(
					model,
					req.params.id,
					options,
					simple
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
				if (object.included && object.included.length > 0) {
					jsonAPIObject.included = deduplicateIncluded(object.included);
				}

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

				let idList = null;
				let filter = null;
				if (req.query.filter !== undefined && req.query.filter.id !== undefined)
				{
					idList = req.query.filter.id.split(',');
				}

				// Other filter parameter
				if (req.query.filter !== undefined && req.query.filter.id === undefined)
				{
					filter = req.query.filter;
				}

				const jsonAPIObject = {
					data: []
				};

				// Fetching list of all of model
				if (idList === null && filter === null)
				{
					const instances = await model.findAll(options);

					if (instances)
					{
						instances.forEach((instance) =>
						{
							jsonAPIObject.data.push(buildResourceObjectForInstance(instance, model, true).resourceObject);
						});
					}

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
							separate: true
						});
					});
					associationData.hasOneAssociations.forEach((association) =>
					{
						includes.push({
							model: association.target
						});
					});
					options.include = includes;

					if (idList !== null)
					{
						options.where = {id: idList};
					}
					else if (filter !== null)
					{
						options.where = filter;
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
								const result = buildResourceObjectForInstance(instance, model, false);
								jsonAPIObject.data.push(result.resourceObject);

								// Collect included resources from all instances
								if (result.included && result.included.length > 0) {
									allIncluded.push(...result.included);
								}
							}
						});
					}

					// Add included member if there are related resources (deduplicated)
					if (allIncluded.length > 0) {
						jsonAPIObject.included = deduplicateIncluded(allIncluded);
					}

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

				await row.update(attributes);

				const jsonAPIObject = {
					data: null
				};

				const includes = [];
				associationData.hasManyAssociations.forEach((association) =>
				{
					includes.push({
						model: association.target,
						separate: true
					});
				});
				associationData.hasOneAssociations.forEach((association) =>
				{
					includes.push({
						model: association.target
					});
				});
				options.include = includes;

				const object = await fetchAndBuildResourceObjectForModelById(
					model,
					req.params.id,
					options,
					false
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
				if (object.included && object.included.length > 0) {
					jsonAPIObject.included = deduplicateIncluded(object.included);
				}

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
					return res.status(422).json({ errors });
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
}

async function fetchAndBuildResourceObjectForModelById(model, id, options, simple)
{
	const instance = await model.findByPk(id, options);
	return buildResourceObjectForInstance(instance, model, simple);
}

function buildResourceObjectForInstance(instance, model, simple)
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
						relationshipValues.push(buildResourceIdentifierObject(entity._modelOptions.name.singular, entityRowValues.id));
						included.push(buildSimpleResourceObject(entity, associationData.excludedKeys));
					});
				}
				relationship.data = relationshipValues;
				relationships[associationKey.as[0].toLowerCase() + associationKey.as.substring(1)] = relationship;
			});

			associationData.hasOneAssociations.forEach((associationKey) =>
			{
				const relationship = {};
				if (rowValues[associationKey.as] !== null && rowValues[associationKey.as] !== undefined)
				{
					relationship.data = buildResourceIdentifierObject(
						rowValues[associationKey.as]._modelOptions.name.singular,
						rowValues[associationKey.as].id);
				}
				else
				{
					relationship.data = null;
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
			associationData.belongsToAssociations.push(associations[associationKey]);
		}
	});

	return associationData;
}

// Includes type, id, and attributes for the instance
function buildSimpleResourceObject(instance, excludedAttributes)
{
	const rowValues = instance.get();

	const resourceObject = {
		id: String(rowValues.id), // Convert to string per JSON:API spec
		type: instance._modelOptions.name.singular,
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