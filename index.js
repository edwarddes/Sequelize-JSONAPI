'use strict';

const dasherize = require('dasherize');
const inflection = require('inflection');

class jsonapi
{
	static createRoutesForModel(router, model)
	{
		const modelNameForRoute = dasherize(inflection.pluralize(model.name));

		router.get('/' + modelNameForRoute, jsonapi.GetList(model));
		router.get('/' + modelNameForRoute + '/:id', jsonapi.GetSingle(model));
		router.patch('/' + modelNameForRoute + '/:id', jsonapi.Update(model));
		router.delete('/' + modelNameForRoute + '/:id', jsonapi.Delete(model));
		router.post('/' + modelNameForRoute, jsonapi.Create(model));
	}

	static Create(model)
	{
		return async function(req, res, next)
		{
			try {
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
				res.status(201).json(jsonAPIObject);
			} catch (error) {
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
					res.sendStatus(404);
				}
				else
				{
					await instance.destroy();
					res.sendStatus(204);
				}
			} catch (error) {
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
					res.status(404).end();
				}
				else
				{
					jsonAPIObject.data = object.resourceObject;
					// jsonAPIObject.included = object.included;
					res.json(jsonAPIObject);
				}
			} catch (error) {
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
								jsonAPIObject.data.push(buildResourceObjectForInstance(instance, model, false).resourceObject);
							}
						});
					}

					res.json(jsonAPIObject);
				}
			} catch (error) {
				next(error);
			}
		};
	}

	static Update(model)
	{
		return async function(req, res, next)
		{
			try {
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
					res.sendStatus(404);
					return;
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
					res.status(404).end();
				}
				else
				{
					jsonAPIObject.data = object.resourceObject;
					res.json(jsonAPIObject);
				}
			} catch (error) {
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
		id: rowValues.id,
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
		id: id,
		type: modelName
	};
}

module.exports = jsonapi;