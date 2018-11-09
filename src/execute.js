'use strict';

const querystring = require('querystring');

const _ = require('lodash');

const injectInput = require('./http-middlewares/before/inject-input');
const prepareRequest = require('./http-middlewares/before/prepare-request');
const addQueryParams = require('./http-middlewares/before/add-query-params');
const throwForStatus = require('./http-middlewares/after/throw-for-status');
const createJSONtool = require('./tools/create-json-tool');
const ensureArray = require('./tools/ensure-array');
const ZapierPromise = require('./tools/promise');

const constants = require('./constants');

const executeHttpRequest = (input, options) => {
  options = _.extend({}, options, constants.REQUEST_OBJECT_SHORTHAND_OPTIONS);
  return input.z.request(options).then(throwForStatus);
};

const executeInputOutputFields = (inputOutputFields, input) => {
  inputOutputFields = ensureArray(inputOutputFields);

  return ZapierPromise.all(
    inputOutputFields.map(
      field => (_.isFunction(field) ? field(input.z, input.bundle) : field)
    )
  ).then(fields => _.flatten(fields));
};

const executeCallbackMethod = (z, bundle, method) => {
  return new ZapierPromise((resolve, reject) => {
    const callback = (err, output) => {
      if (err) {
        reject(err);
      } else {
        resolve(output);
      }
    };

    method(z, bundle, callback);
  });
};

const isInputOutputFields = methodName =>
  methodName.match(/\.(inputFields|outputFields)$/);

const isRenderOnly = methodName =>
  _.indexOf(constants.RENDER_ONLY_METHODS, methodName) >= 0;

const isOAuth1TokenMethod = (app, methodName) =>
  methodName.match(/\.(getRequestToken|getAccessToken)$/) &&
  _.get(app, 'authentication.type') === 'oauth1';

const execute = (app, input) => {
  const z = input.z;
  const methodName = input._zapier.event.method;
  const method = _.get(app, methodName);
  const bundle = input._zapier.event.bundle || {};

  if (isInputOutputFields(methodName)) {
    return executeInputOutputFields(method, input);
  } else if (_.isFunction(method)) {
    // TODO: would be nice to be a bit smarter about this
    // either by only setting props we know are used or by
    // moving this safing code into before middleware
    bundle.authData = bundle.authData || {};
    bundle.inputData = bundle.inputData || {};
    if (method.length >= 3) {
      return executeCallbackMethod(input.z, bundle, method);
    }
    return method(z, bundle);
  } else if (_.isObject(method) && method.url) {
    const options = method;
    if (isRenderOnly(methodName)) {
      const requestWithInput = _.extend(
        {},
        injectInput(input)(options),
        constants.REQUEST_OBJECT_SHORTHAND_OPTIONS
      );
      const preparedRequest = addQueryParams(prepareRequest(requestWithInput));
      return preparedRequest.url;
    }

    const responsePromise = executeHttpRequest(input, options);
    if (isOAuth1TokenMethod(app, methodName)) {
      // We expect the response body returned by OAuth1 getRequestToken and
      // getAccessToken is form-urlencoded
      return responsePromise.then(res => querystring.parse(res.content));
    }
    return responsePromise.then(resp => createJSONtool().parse(resp.content));
  } else {
    throw new Error(
      `Error: Could not find the method to call: ${input._zapier.event.method}`
    );
  }
};

module.exports = execute;
