'use strict';

var dasherize = require('dasherize');
var inflection = require('inflection');
var Promise = require('bluebird');

class jsonapi 
{
	static createRoutesForModel(router,model)
	{
		var modelNameForRoute = dasherize(inflection.pluralize(model.name));
		
		router.get('/'+modelNameForRoute,jsonapi.GetList(model));
		router.get('/'+modelNameForRoute+'/:id',jsonapi.GetSingle(model));
		router.patch('/'+modelNameForRoute+'/:id',jsonapi.Update(model));
		router.delete('/'+modelNameForRoute+'/:id',jsonapi.Delete(model));
		router.post('/'+modelNameForRoute,jsonapi.Create(model));
	}

	static Create(model)
	{
		return function(req,res,next)
		{
			var attributes = req.body.data.attributes;
			var relationships = req.body.data.relationships;
        
			var jsonAPIObject = {
				data: {},
			};
		
			var associationData = AssociationDataForModel(model);
			associationData.belongsToAssociations.forEach(function(belongsTo)
			{
				var relationship = relationships[belongsTo.foreignKey];
				if(relationship != null)
				{
					if(relationship.data != null)
					{
						attributes[belongsTo.foreignKey] = relationship.data.id;
					}
					else
					{
						attributes[belongsTo.foreignKey] = null;
					}
				}
			})
		
	        model
	            .create(attributes)
	            .then(respond)
	            .catch(next);
        
	        function respond(row) 
			{
				jsonAPIObject.data = JSONAPIResourceIdentifierObjectForID(model.name,row.get('id'));
	            res.status(201).json(jsonAPIObject);
	        }
		}
	}

	static Delete(model)
	{
		return function(req,res,next)
		{
			var options = req.options || {}; 

		    options.where = options.where || {};
		    options.where[model.primaryKeyAttribute] = req.params.id;

		    model.findOne(options).then(function(instance)
			{
	            if (!instance) 
				{
	                res.sendStatus(404);
	            } 
				else 
				{
	                return instance.destroy();
	            }
			})
			.then(function()
			{
				res.sendStatus(204);
			})
		}
	}

	static GetSingle(model)
	{	
		return function(req,res,next)
		{	
			var options = req.options || {};
			options.where = options.where || {};

			var jsonAPIObject = {
				data: null
			};
		
			var simple = req.query.simple || false;
			if(!simple)
			{
				var associationData = AssociationDataForModel(model);
				var includes = [];
				associationData.hasManyAssociations.forEach(function(association)
				{
					includes.push(
					{
						model: association.target,
						separate: true
					});
				});
				associationData.hasOneAssociations.forEach(function(association)
				{
					includes.push({model: association.target});
				});
				options.include = includes;
			}

			FetchAndBuildResourceObjectForModelByID(
				model,
				req.params.id,
				options,
				simple
			).then(function(object)
			{
				if(object == null)
				{
					res.status(404).end();
				}
				else
				{
					jsonAPIObject.data = object.resourceObject
					//jsonAPIObject.included = object.included;
					res.json(jsonAPIObject);
				}
			});
		};
	}

	static GetList(model)
	{
		return function(req,res,next)
		{	
			var options = req.options || {};
			options.where = options.where || {};
		
			var idList = null;
			var filter = null
			if(req.query.filter != undefined && req.query.filter.id != undefined)
			{
				idList = req.query.filter.id.split(',');
			}
			
			//other filter parameter
			if(req.query.filter != undefined && req.query.filter.id == undefined)
			{
				filter = req.query.filter;
			}
		
			var jsonAPIObject = {
				data: []
			};

			//fetching list of all of model
			if(idList == null && filter == null)
			{
				model
					.findAll(options)
					.then(function(instances)
				{
					if (instances) 
					{
						instances.forEach(function(instance)
						{
							jsonAPIObject.data.push(BuildResourceObjectForInstance(instance,model,true).resourceObject);
					
						});
				   	}
				}).then(function()
				{
					res.json(jsonAPIObject);
				});
			}
			//fetching specific instances of model coalesced
			else
			{	
				var associationData = AssociationDataForModel(model);
	
				var includes = [];
				associationData.hasManyAssociations.forEach(function(association)
				{
					includes.push(
					{
						model: association.target,
						separate: true
					});
				});
				associationData.hasOneAssociations.forEach(function(association)
				{
					includes.push({model: association.target});
				});
				options.include = includes;
				
				if(idList != null)
				{
					options.where = {id: idList};
				}
				else if(filter != null)
				{
					options.where = filter;
				}
				
				model
					.findAll(options)
					.then(function(instances)
				{
					if (instances) 
					{
						instances.forEach(function(instance)
						{
							if(instance == null)
							{
								res.status(404).end();
							}
							else
							{
								jsonAPIObject.data.push(BuildResourceObjectForInstance(instance,model,false).resourceObject);
							}
					
						});
				   	}
				}).then(function()
				{
					res.json(jsonAPIObject);
				});
			}
		};
	}

	static Update(model)
	{
		return function(req,res,next)
		{
			var body = req.body,
	            options = req.options || {}; 
				
	        options.where = options.where || {};
	        options.where[model.primaryKeyAttribute] = req.params.id;
		
			var associationData = AssociationDataForModel(model);
		
			var attributes = body.data.attributes;
			var relationships = body.data.relationships;
	        model
	            .findOne(options)
	            .then(updateAttributes)
	            .then(respond)
	            .catch(next);
            
	        function updateAttributes(row) 
			{
	            if (!row) 
				{
	                res.sendStatus(404);
	            } 
				else 
				{
					var attributes = body.data.attributes;
					//if the column is an integer column it needs null for a blank value not ''
					//this doesn't hurt string columns, at least in my cases
					Object.keys(attributes).forEach(key =>
					{
						if(attributes[key] == '')
							attributes[key] = null;
					})
					
					associationData.belongsToAssociations.forEach(function(belongsTo)
					{
						var relationship = relationships[belongsTo.foreignKey];
						if(relationship.data != null)
						{
							attributes[belongsTo.foreignKey] = relationship.data.id;
						}
						else
						{
							attributes[belongsTo.foreignKey] = null;
						}
					})
	                return row.updateAttributes(attributes);
	            }
	        }
        
	        function respond(row) 
			{
				var jsonAPIObject = {};
				jsonAPIObject["data"] = null;
		
				var includes = [];
				associationData.hasManyAssociations.forEach(function(association)
				{
					includes.push(
					{
						model: association.target,
						separate: true
					});
				});
				associationData.hasOneAssociations.forEach(function(association)
				{
					includes.push({model: association.target});
				});
				options.include = includes;
		
				FetchAndBuildResourceObjectForModelByID(
					model,
					req.params.id,
					options,
					false
				).then(function(object)
				{
					if(object == null)
					{
						res.status(404).end();
					}
					else
					{
						jsonAPIObject["data"] = object.resourceObject
						res.json(jsonAPIObject);
					}
				});
	        }	
		}
	}
}

function FetchAndBuildResourceObjectForModelByID(model,id,options,simple)
{
	return model
		.findByPk(id,options)
		.then(function(instance)
	{
		return BuildResourceObjectForInstance(instance,model,simple);
	})
};

function BuildResourceObjectForInstance(instance,model,simple)
{
	if (instance) 
	{
		var rowValues = instance.get();

		var relationships = {};
		var included = [];
		
		var associationData = AssociationDataForModel(model);
		var resourceObject = JSONAPISimpleResourceObject(instance,associationData.excludedKeys);
		
		//controls including the included and relationships
		if(!simple)
		{
			associationData.hasManyAssociations.forEach(function(associationKey)
			{
				var relationship = {};
			
				var entities = rowValues[associationKey.as];
				var relationshipValues = [];
				if(entities)
				{
					entities.forEach(function(entity)
					{
						var entityRowValues = entity.get();
						relationshipValues.push(JSONAPIResourceIdentifierObjectForID(entity._modelOptions.name.singular,entityRowValues['id']));
						included.push(JSONAPISimpleResourceObject(entity,associationData.excludedKeys));
					});
				}
				relationship['data'] = relationshipValues;
				relationships[associationKey.as[0].toLowerCase() + associationKey.as.substring(1)] = relationship;
			});	
		
		
			associationData.hasOneAssociations.forEach(function(associationKey)
			{
				var relationship = {};
				if(rowValues[associationKey.as] != null)
				{
					relationship['data'] = JSONAPIResourceIdentifierObjectForID(
						rowValues[associationKey.as]._modelOptions.name.singular,
						rowValues[associationKey.as].id);
				}
				else
				{
					relationship['data'] = null;
				}
				relationships[associationKey.as+"Id"] = relationship;
			});
		
			associationData.belongsToAssociations.forEach(function(associationKey)
			{
				var relationship = {};
			
				if(rowValues[associationKey.foreignKey] != null)
				{
					relationship['data'] = JSONAPIResourceIdentifierObjectForID(
						associationKey.target.options.name.singular,
						rowValues[associationKey.foreignKey]);	
				}
				else
				{
					relationship['data'] = null;
				}	
				relationships[associationKey.foreignKey] = relationship;
			})
			
			resourceObject.relationships = relationships;
		}
		
		return {resourceObject:resourceObject, included:included};
   	}
	else
	{
		return null;
	}
};

function AssociationDataForModel(model)
{
	var associations = model.associations;
	
	var associationData = {
		hasManyAssociations: [],
		hasOneAssociations: [],
		belongsToAssociations: [],
		excludedKeys: []
	};

	Object.keys(associations).forEach(function(associationKey)
	{
		var associationType = associations[associationKey].associationType;
		if(associationType == "HasMany")
		{
			associationData.hasManyAssociations.push(associations[associationKey]);
			associationData.excludedKeys.push(associations[associationKey].as);
		}
		if(associationType == "HasOne")
		{
			associationData.hasOneAssociations.push(associations[associationKey]);
			associationData.excludedKeys.push(associations[associationKey].as);
		}	
		if(associationType == "BelongsTo")
		{
			associationData.excludedKeys.push(associations[associationKey].foreignKey);
			associationData.belongsToAssociations.push(associations[associationKey]);
		}		
	});
	
	return associationData;
};

//includes type, id, and attributes for the instance
function JSONAPISimpleResourceObject(instance,excludedAttributes)
{
	var rowValues = instance.get();

	var resourceObject = {
		id: rowValues['id'],
		type: instance._modelOptions.name.singular,
		attributes: {},
	};

	Object.keys(instance.dataValues).forEach(function(key)
	{
		if(key != "id" && !excludedAttributes.includes(key))
		{
			resourceObject.attributes[key] = rowValues[key];
		}
	});

	return resourceObject;
};

//includes only type and id
function JSONAPIResourceIdentifierObjectForID(modelName,id)
{
	return {
		id: id,
		type: modelName
	};
};

module.exports = jsonapi;