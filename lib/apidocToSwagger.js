// Custom update done by Wilson Zheng
// - add handling of datetime and date type
// - remove queryParam in path
// - fix createPathParameters not creating "URL Parameters"
// - remove successful response schema property if verbDefinitionResult.topLevelSuccessRefType is undefined
// - fix all type to lowercase
// - fix the 'in' property for query string parameters. They were always "in: path" before. Now change them to "in: query" 
// - add junifer custom url replacing
// - correct summary and description fields of paths
// - decode symbol in string
// - Only keep the number of error code for response.
// - Support array type in query string parameters
// - Add standard error schema for junifer error
// - Add feature of auto generating example for API success response


// TODO: 1. fix accounts/:id/productDetails and /accounts/:id/tariffInformation not generating examples
//		 2. support post request example
//		 3. add security for each endpoint 
//			security:
//			- tokenAuth: []
//		 4. auto add Junifer prefix for tags
//		 5. links description
//		 6. fix results: [ [....] ] has extra [], example should be indented one level up, require session should be before example session
var _ = require('lodash');
var pathToRegexp = require('path-to-regexp');

var swagger = {
	swagger: "2.0",
	info: {},
	paths: {},
	definitions: {}
};

function toSwagger(apidocJson, projectJson) {
	swagger.info = addInfo(projectJson);
	swagger.paths = extractPaths(apidocJson);
	return swagger;
}

var tagsRegex = /(<([^>]+)>)/ig;
// Removes <p> </p> tags from text and restores quotes
function removeTags(text) {
	var textWithTagsRemoved = text ? (text.replace(tagsRegex, "")).trim() : "";
	return textWithTagsRemoved.replace(/&quot;/g, "\"")
		.replace(/&gt;/g, ">")
		.replace(/&lt;/g, "<")
		.replace(/&amp;/g, "&")
		.replace(/&apos;/g, "'")
		.replace(/&#39;/g, "'");
}

function addInfo(projectJson) {
	var info = {};
	info["title"] = projectJson.title || projectJson.name;
	info["version"] = projectJson.version;
	info["description"] = projectJson.description;
	return info;
}

/**
 * Extracts paths provided in json format
 * post, patch, put request parameters are extracted in body
 * get and delete are extracted to path parameters
 * @param apidocJson
 * @returns {{}}
 */
function extractPaths(apidocJson) {
	var apiPaths = groupByUrl(apidocJson);
	var paths = {};
	for (var i = 0; i < apiPaths.length; i++) {
		var verbs = apiPaths[i].verbs;
		// In the event the url is having query params
		var url = verbs[0].url.split("?")[0];
		url = juniferCustomUrl(url);
		var pattern = pathToRegexp(url, null);
		var matches = pattern.exec(url);

		// Surrounds URL parameters with curly brackets -> :email with {email}
		var pathKeys = [];
		if (matches) {
			for (var j = 1; j < matches.length; j++) {
				var key = matches[j].substr(1);
				url = url.replace(matches[j], "{" + key + "}");
				pathKeys.push(key);
			}
		}
		for (var j = 0; j < verbs.length; j++) {
			var verb = verbs[j];
			var type = verb.type;

			var obj = paths[url] = paths[url] || {};

			if (type == 'post' || type == 'patch' || type == 'put') {
				_.extend(obj, createPostPushPutOutput(verb, swagger.definitions, pathKeys));
			} else {
				_.extend(obj, createGetDeleteOutput(verb, swagger.definitions));
			}
		}
	}
	return paths;
}

function createPostPushPutOutput(verbs, definitions, pathKeys) {
	var pathItemObject = {};
	var verbDefinitionResult = createVerbDefinitions(verbs, definitions);

	var params = [];
	var pathParams = createPathParameters(verbs, pathKeys);

	/* Added objects and array support for params */

	for (var i = 0; i < pathParams.length; i++) {
		var pathParam = pathParams[i];
		var paramType = pathParam.type;
		if (pathParam.type !== "string" && pathParam.type !== "number" && pathParam.type !== "boolean") {
			pathParams.splice(i, 1);
			var typeIn = paramType.indexOf("[]");

			if (typeIn !== -1 && typeIn === (pathParam.type.length - 2)) {
				paramType = paramType.slice(0, paramType.length - 2);
				if (paramType == "object") {
					paramType = pathParam.name;
				}
				pathParams.push({
					"in": "body",
					"name": pathParam.name,
					"description": removeTags(pathParam.description),
					"required": required,
					"schema": {
						"type": "array",
						"items": {
							"$ref": "#/definitions/" + paramType
						}
					}
				});
			}
			else {
				if (pathParam.type == "object") {
					paramType = pathParam.name;
				}
				pathParams.push({
					"in": "body",
					"name": pathParam.name,
					"description": removeTags(pathParam.description),
					"required": required,
					"schema": {
						"$ref": "#/definitions/" + paramType
					}
				});
			}



		}

	}

	params = params.concat(pathParams);
	var required = verbs.parameter && verbs.parameter.fields && verbs.parameter.fields.Parameter && verbs.parameter.fields.Parameter.length > 0;

	pathItemObject[verbs.type] = {
		tags: [verbs.group],
		summary: removeTags(verbs.title),
		description: removeTags(verbs.description),
		consumes: [
			"application/json"
		],
		produces: [
			"application/json"
		],
		parameters: params
	}
	
	

	pathItemObject[verbs.type].responses = {};
	if (verbDefinitionResult.topLevelSuccessRef) {
		pathItemObject[verbs.type].responses["200"] = {};
		pathItemObject[verbs.type].responses["200"].description = verbDefinitionResult.topLevelSuccessRefDesc;
		if (verbDefinitionResult.topLevelSuccessRef !== verbs.name) {
			pathItemObject[verbs.type].responses["200"].schema = {};
			if (verbDefinitionResult.topLevelSuccessRefType == "array") {
				pathItemObject[verbs.type].responses["200"].schema.type = verbDefinitionResult.topLevelSuccessRefType;
				pathItemObject[verbs.type].responses["200"].schema.items = {};
				pathItemObject[verbs.type].responses["200"].schema.items.$ref = "#/definitions/" + verbDefinitionResult.topLevelSuccessRef
			}
			else {
				pathItemObject[verbs.type].responses["200"].schema.$ref = "#/definitions/" + verbDefinitionResult.topLevelSuccessRef
			}
		}
	}
	//buildPathItemSuccessResponses(pathItemObject, verbDefinitionResult, verbs);
	buildPathItemErrorResponses(pathItemObject, verbDefinitionResult, verbs);

	return pathItemObject;
}

function createVerbDefinitions(verbs, definitions) {
	var result = {
		topLevelParametersRef: null,
		topLevelSuccessRef: null,
		topLevelSuccessRefType: null,
		topLevelSuccessRefDesc: null,
		topLevelError: new Array()
	};
	var defaultObjectName = verbs.name;

	var fieldArrayResult = {};
	if (verbs && verbs.parameter && verbs.parameter.fields) {
		fieldArrayResult = createFieldArrayDefinitions(verbs.parameter.fields.Parameter, definitions, verbs.name, defaultObjectName, undefined);
		result.topLevelParametersRef = fieldArrayResult.topLevelRef;
	};

	if (verbs && verbs.success && verbs.success.fields) {
		var successField = verbs.success.fields["Success 200"];
		if (!successField)
			successField = verbs.success.fields["200"]

		// build success examples response if exists
		if (verbs.success.examples) {
			let exampleContent = parseJuniferContent(verbs.success.examples);
			if (exampleContent.results) {
				fieldArrayResult = createResultArrayDefinitions(successField, definitions, verbs.name, defaultObjectName, exampleContent);
			}
			else {
				fieldArrayResult = createFieldArrayDefinitions(successField, definitions, verbs.name, defaultObjectName, exampleContent);
			}
		}
		else {
			fieldArrayResult = createFieldArrayDefinitions(successField, definitions, verbs.name, defaultObjectName, undefined);
		}
		result.topLevelSuccessRef = fieldArrayResult.topLevelRef;
		result.topLevelSuccessRefType = fieldArrayResult.topLevelRefType;
		result.topLevelSuccessRefDesc = "Success";
	};
	/* Added support for error handling */
	if (verbs && verbs.error && verbs.error.fields) {
		var errorInfoArray = [];
		for (var property in verbs.error.fields) {
			if ((verbs.error.fields).hasOwnProperty(property)) {
				errorArrayResult = createErrorDefinitions(verbs.error.fields[property], verbs.name);
				errorArrayResult.forEach(element => {
					var errorInfo = new Object();
					errorInfo.topLevelErrorGrp = property;
					errorInfo.topLevelErrorRef = element.topLevelRef;
					errorInfo.topLevelErrorRefType = element.topLevelRefType;
					errorInfo.topLevelErrorRefDesc = removeTags(element.topLevelRefDesc);
					errorInfoArray.push(errorInfo);
				});
			}
		}
		result.topLevelError = errorInfoArray;
	};

	return result;
}

function createErrorDefinitions(fieldArray, topLevelRef) {
	let result = [];
	for (var i = 0; i < fieldArray.length; i++) {
		var item = {
			topLevelRef: topLevelRef,
			topLevelRefType: null,
			topLevelRefDesc: null,
		}
		var nestedName = createNestedName(fieldArray[i].field);
		var objectName = nestedName.objectName;
		item.topLevelRef = objectName;
		item.topLevelRefDesc = fieldArray[i].field;
		result.push(item);
	}
	return result;
}

function createFieldArrayDefinitions(fieldArray, definitions, topLevelRef, defaultObjectName, exampleContent) {

	var result = {
		topLevelRef: topLevelRef,
		topLevelRefType: null
	}

	if (!fieldArray) {
		return result;
	}

	for (var i = 0; i < fieldArray.length; i++) {
		var parameter = fieldArray[i];

		var nestedName = createNestedName(parameter.field);
		var objectName = nestedName.objectName;
		if (!objectName) {
			objectName = defaultObjectName;
		}
		var type = parameter.type;
		if (i == 0) {
			result.topLevelRefType = type;
			if (parameter.type == "Object") {
				objectName = nestedName.propertyName;
				nestedName.propertyName = null;
			} else if (parameter.type == "Array") {
				objectName = nestedName.propertyName;
				nestedName.propertyName = null;
				result.topLevelRefType = "array";
			}
			result.topLevelRef = objectName;
		};

		definitions[objectName] = definitions[objectName] ||
			{ properties: {} };

		if (nestedName.propertyName) {
			var prop = {
				type: (parameter.type || "").toLowerCase(),
				description: removeTags(parameter.description)
			};

			if (prop.type.toLowerCase() == "object") {
				prop.properties = buildObjectProperties(exampleContent, nestedName.propertyName);
			} else {
				if (prop.type.toLowerCase() == "date") {
					prop.type = "string";
					prop.format = "date";
				}
				if (prop.type.toLowerCase() == "datetime") {
					prop.type = "string";
					prop.format = "date-time";
				}
				if (prop.type.toLowerCase() == "array") {
					prop.type = "array";
					prop.items = {};
					prop.items.type = "object";
				}

				// Support Example: find the correct example data in exampleContent and assign it to prop.example.
				// Not building example for error response.
				if (!parameter.group.includes("Error")) {
					try {
						if (exampleContent) {
							prop.example = exampleContent[nestedName.propertyName];
						}
					} catch (e) {
						console.log("exampleContent: \n" + JSON.stringify(exampleContent) + "\n");
						throw new Error("Cannot get successful response examples for \n" + topLevelRef + "[" + nestedName.propertyName + "]. \nPlease check if the input file's Success-Response session contains the related data.\n" + e.message);
					}
				}

			}
			if (type) {
				var typeIndex = type.indexOf("[]");
				if (typeIndex !== -1 && typeIndex === (type.length - 2)) {
					prop.type = "array";
					prop.items = {
						type: type.slice(0, type.length - 2).toLowerCase()
					};
				}
				//build object type result
				definitions[objectName]['properties'][nestedName.propertyName] = prop;
				if (!parameter.optional) {
					var arr = definitions[objectName]['required'];
					//  Make required only exist when there are required elements
					if (arr == null) {
						definitions[objectName]['required'] = [];
						arr = definitions[objectName]['required'];
					}
					if (arr.indexOf(nestedName.propertyName) === -1) {
						arr.push(nestedName.propertyName);
					}
				};

			}
		};
	}
	return result;
}

function createResultArrayDefinitions(fieldArray, definitions, topLevelRef, defaultObjectName, exampleContent) {

	var result = {
		topLevelRef: topLevelRef,
		topLevelRefType: null
	}

	if (!fieldArray) {
		return result;
	}

	if (exampleContent) {
		try {
			if (exampleContent.hasOwnProperty("results") && typeof exampleContent.results === "Array" || "array") {
				buildResultsStructure(exampleContent, definitions, topLevelRef);
			}
		} catch (e) {
			console.log("Failed at exampleContent.results: \n" + JSON.stringify(exampleContent.results) + "\n");
			throw new Error(e);
		}
	}

	for (var i = 0; i < fieldArray.length; i++) {
		var parameter = fieldArray[i];

		var nestedName = createNestedName(parameter.field);
		var objectName = nestedName.objectName;
		if (!objectName) {
			objectName = defaultObjectName;
		}
		var type = parameter.type;
		if (i == 0) {
			result.topLevelRefType = type;
			if (parameter.type == "Object") {
				objectName = nestedName.propertyName;
				nestedName.propertyName = null;
			} else if (parameter.type == "Array") {
				objectName = nestedName.propertyName;
				nestedName.propertyName = null;
				result.topLevelRefType = "array";
			}
			result.topLevelRef = objectName;
		};

		definitions[objectName] = definitions[objectName] ||
			{ properties: {} };

		if (nestedName.propertyName) {
			var prop = {
				type: (parameter.type || "").toLowerCase(),
				description: removeTags(parameter.description)
			};

			if (prop.type.toLowerCase() == "object") {
				prop.properties = buildObjectProperties(exampleContent, nestedName.propertyName);
			} else {
				if (prop.type.toLowerCase() == "date") {
					prop.type = "string";
					prop.format = "date";
				}
				if (prop.type.toLowerCase() == "datetime") {
					prop.type = "string";
					prop.format = "date-time";
				}
				if (prop.type.toLowerCase() == "array") {
					prop.type = "array";
					prop.items = {};
					prop.items.type = "object";
				}

				// Support Example: find the correct example data in exampleContent and assign it to prop.example.
				// Not building example for error response.
				if (!parameter.group.includes("Error")) {
					try {
						if (exampleContent) {
							prop.example = exampleContent[nestedName.propertyName];
						}
					} catch (e) {
						console.log("exampleContent:" + JSON.stringify(exampleContent) + "\n");
						throw new Error("Cannot get successful response examples for " + topLevelRef + "[" + nestedName.propertyName + "]. Please check if the input file's Success-Response session contains the related data.\n" + e.message);
					}
				}
			}
			if (type) {
				var typeIndex = type.indexOf("[]");
				if (typeIndex !== -1 && typeIndex === (type.length - 2)) {
					prop.type = "array";
					prop.items = {
						type: type.slice(0, type.length - 2).toLowerCase()
					};
				}

				// build array type of result 
				if (exampleContent.hasOwnProperty('results') && typeof exampleContent.results == "Array" || "array") {
					definitions[topLevelRef]['properties']['results']['items']['properties'][nestedName.propertyName] = prop;
					if (!parameter.optional) {
						var arr = definitions[topLevelRef]['properties']['results']['items']['required'];
						//  Make required only exist when there are required elements
						if (arr == null) {
							definitions[topLevelRef]['properties']['results']['items']['required'] = [];
							arr = definitions[topLevelRef]['properties']['results']['items']['required'];
						}
						if (arr.indexOf(nestedName.propertyName) === -1) {
							arr.push(nestedName.propertyName);
						}
					};
				}

			}
		};
	}
	return result;
}

function createNestedName(field) {
	var propertyName = field;
	var objectName;
	var propertyNames = field.split(".");
	if (propertyNames && propertyNames.length > 1) {
		propertyName = propertyNames[propertyNames.length - 1];
		propertyNames.pop();
		objectName = propertyNames.join(".");
	}

	return {
		propertyName: propertyName,
		objectName: objectName
	}
}


/**
 * Generate get, delete method output
 * @param verbs
 * @returns {{}}
 */
function createGetDeleteOutput(verbs, definitions) {
	var pathItemObject = {};
	verbs.type = verbs.type === "del" ? "delete" : verbs.type;

	var verbDefinitionResult = createVerbDefinitions(verbs, definitions);
	pathItemObject[verbs.type] = {
		tags: [verbs.group],
		summary: removeTags(verbs.title),
		description: removeTags(verbs.description),
		consumes: [
			"application/json"
		],
		produces: [
			"application/json"
		],
		parameters: createPathParameters(verbs)
	}
	buildPathItemSuccessResponses(pathItemObject, verbDefinitionResult, verbs);
	buildPathItemErrorResponses(pathItemObject, verbDefinitionResult, verbs);
	
	return pathItemObject;
}

/* Added object and array support for responses */
function buildPathItemSuccessResponses(pathItemObject, verbDefinitionResult, verbs) {

	pathItemObject[verbs.type].responses = {};
	if (verbDefinitionResult.topLevelSuccessRef) {
		pathItemObject[verbs.type].responses["200"] = {};
		pathItemObject[verbs.type].responses["200"].description = verbDefinitionResult.topLevelSuccessRefDesc;
		pathItemObject[verbs.type].responses["200"].schema = {};
		if (verbDefinitionResult.topLevelSuccessRefType == "array") {
			pathItemObject[verbs.type].responses["200"].schema.type = verbDefinitionResult.topLevelSuccessRefType;
			pathItemObject[verbs.type].responses["200"].schema.items = {};
			pathItemObject[verbs.type].responses["200"].schema.items.$ref = "#/definitions/" + verbDefinitionResult.topLevelSuccessRef
		}
		else {
			pathItemObject[verbs.type].responses["200"].schema.$ref = "#/definitions/" + verbDefinitionResult.topLevelSuccessRef
		}
	}
}

/* Added error response support handling multiple error codes*/
function buildPathItemErrorResponses(pathItemObject, verbDefinitionResult, verbs) {

	if (verbDefinitionResult.topLevelError) {
		for (var k = 0; k < verbDefinitionResult.topLevelError.length; k++) {
			var topLevelObject = verbDefinitionResult.topLevelError[k];
			topLevelObject.topLevelErrorGrp = topLevelObject.topLevelErrorGrp.replace(/\D/g, ''); // Only keep the error code number.

			let error = {};
			error.description = topLevelObject.topLevelErrorRefDesc;
			error.schema = {};
			error.schema.$ref = "#/definitions/JuniferError"; // customise for junifer
			pathItemObject[verbs.type].responses[topLevelObject.topLevelErrorGrp] = error;
		}
	}
}


/**
 * Iterate through all method parameters and create array of parameter objects which are stored as path parameters
 * @param verbs
 * @returns {Array}
 */
function createPathParameters(verbs, pathKeys) {
	pathKeys = pathKeys || [];

	var pathItemObject = [];

	//Support URL parameter
	if (verbs.parameter && verbs.parameter.fields["URL Parameter"]) {
		var queryStringParams = getQueryStringParams(verbs);
		for (var i = 0; i < verbs.parameter.fields["URL Parameter"].length; i++) {
			var param = verbs.parameter.fields["URL Parameter"][i];
			var field = param.field;
			var type = removeTags(param.type);

			if (param.allowedValues) {
				pathItemObject.push({
					name: field,
					in: "query",
					required: !param.optional,
					type: caseCorrectType(removeTags(param.type).toLowerCase()),
					description: removeTags(param.description),
					enum: param.allowedValues
				});
			}
			else {
				var inValue = "path";
				if (type === "file")
					inValue = "formData";
				else if (queryStringParams.indexOf(field) !== -1)
					inValue = "query";
				else if (param.optional)
					inValue = "query";

				// Support query string which is either array, date or datetime type
				var obj = {
					name: field,
					in: inValue,
					required: !param.optional,
					type: caseCorrectType(removeTags(param.type).toLowerCase()),
					description: removeTags(param.description)
				}

				if (type.toLowerCase() == "array") {
					obj.items = {
						type: "string"
					}
				}
				else if (type.toLowerCase() == "date") {
					obj.type = "string";
					obj.format = "date";
				}
				else if (type.toLowerCase() == "datetime") {
					obj.type = "string";
					obj.format = "date-time";
				}
				pathItemObject.push(obj);
			}
		}
	}

	if (verbs.parameter) {
		var queryStringParams = getQueryStringParams(verbs);
		if (verbs.parameter.fields && verbs.parameter.fields.Parameter && verbs.parameter.fields.Parameter.length) {
			for (var i = 0; i < verbs.parameter.fields.Parameter.length; i++) {
				var param = verbs.parameter.fields.Parameter[i];
				var field = param.field;
				var type = removeTags(param.type);
				if (param.allowedValues) {
					pathItemObject.push({
						name: field,
						in: "query",
						required: !param.optional,
						type: caseCorrectType(removeTags(param.type)),
						description: removeTags(param.description),
						enum: param.allowedValues
					});
				}
				else {
					var inValue = "path";
					if (type === "file")
						inValue = "formData";
					else if (queryStringParams.indexOf(field) !== -1)
						inValue = "query";
					else if (param.optional)
						inValue = "query";

					pathItemObject.push({
						name: field,
						in: inValue,
						required: !param.optional,
						type: caseCorrectType(removeTags(param.type)),
						description: removeTags(param.description)
					});
				}
			}
		}
	}
	return pathItemObject;
}

/**
 * A helper method which will scan the URL and determine which variables enclosed in {} are a part of the query string and not the path
 * @param The verb
 * @return {Array} An array of parameters which are a part of the query string and not the path
 */
function getQueryStringParams(verb) {
	var getParamRegExp = /\{(.*?)\}/g

	var indexOfQueryString = verb.url.indexOf("?");
	var queryStringParams = [];

	if (indexOfQueryString != -1) {
		var currentParam;
		while ((currentParam = getParamRegExp.exec(verb.url)) !== null) {
			if (getParamRegExp.lastIndex > indexOfQueryString) {
				queryStringParams.push(currentParam[1]);
			}
		}
	}

	return queryStringParams;
}

/**
 * A helper method to case correct types. This will lower case swagger types and leave others alone
 * @param The type to correct
 * @return If it is a swagger type, it will return the lower case, otherwise, it will leave it alone
 */
function caseCorrectType(typeToCorrect) {
	var swaggerTypes = ["integer", "number", "string", "boolean"]
	var lowerCaseType = typeToCorrect.toLowerCase();
	if (swaggerTypes.indexOf(lowerCaseType) != -1) {
		return lowerCaseType;
	}
	return typeToCorrect;
}


function groupByUrl(apidocJson) {
	return _.chain(apidocJson)
		.groupBy("url")
		.pairs()
		.map(function (element) {
			return _.object(_.zip(["url", "verbs"], element));
		})
		.value();
}

module.exports = {
	toSwagger: toSwagger
};

//The following methods are customisation for Junifer
function juniferCustomUrl(url) {
	return url.replace("rest/v1", "junifer");
}

function buildObjectProperties(exampleContent, propertyName) {
	let properties = {};
	let exampleObj = exampleContent[propertyName];
	for (const prop in exampleObj) {
		properties[prop] = {};
		if (typeof prop != "Object") {
			properties[prop].description = prop;
			properties[prop].type = "string";
			properties[prop].example = exampleContent[propertyName][prop];
		} else {
			buildObjectProperties(exampleContent[propertyName], prop);
		}
	}
	return properties;
}


function buildResultExample(content, exampleObj) {
	if (Array.isArray(content)) {
		for (const i of content) {
			buildResultExample(i, exampleObj);
		}
	}
	else if (typeof content === "object") {
		for (const prop in content) {
			if (content.hasOwnProperty(prop)) {
				exampleObj[prop] = content[prop];
			}
		}
	}
	return exampleObj;
}

function parseJuniferContent(examples) {
	if (examples) {
		let successExample = examples.filter(o => {
			if (o.title.includes("Success")) {
				return o;
			}
		});
		try {
			// In Junifer, most of the api doc json type has no double quotation for object property.
			// Need converting it into valid JSON string by the following code, in order to parse it back to JSON object.
			if (successExample[0]) {
				validJsonString = successExample[0].content
					.split("\n").map((sinleLine) => {
						return sinleLine.replace(/^\s*([a-zA-Z0-9-/]+)\s*:/g, "\"$1\":")
							.replace(/http([s]*):\/\/([a-zA-Z0-9-.:]+)\/rest\/v1/g, "https://api.integration.gentrack.cloud/v1/junifer");
					}).join("\n");
				return JSON.parse(validJsonString);
			}
		} catch (e) {
			console.log("successExample received: \n" + JSON.stringify(successExample[0]) + "\n");
			console.log("Tried to parse: \n" + validJsonString + "\n But failed.");
			throw new Error("Cannot parse the API doc successful response examples. Please check if the input file is a valid Json. Probably missing comma ending or syntax error.\n" + e.message);
		}
	}
}

function buildResultsStructure(exampleContent, definitions, topLevelRef) {
	let results = {};
	results.type = 'array';
	results.items = {};
	results.items.type = 'object';
	results.items.properties = {};
	results.items.example = [];
	if (exampleContent.results) {
		for (const item of exampleContent.results) {
			let i = {};
			let obj = buildResultExample(item, i);
			results.items.example.push(obj);
		}
	}
	definitions[topLevelRef] = { properties: { results } };
}