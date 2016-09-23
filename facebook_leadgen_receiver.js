console.log('Loading event');
var aws = require('aws-sdk');
var async = require('async');
var _ = require('lodash');
var config = require('config');
var bridgNodeSdk = require('bridg-node-sdk');
var moment = require('moment');
var request = require('request');
var bridgContactSubscriber = require('./contact-subscriber');

var table = config.dynamoDBTable;
var clientCode = config.clientCode;

var apiUrl,
  apiToken,
  accountId;

var fbAccessTokenValidity = 55; //access token validity in days

aws.config.update({
  accessKeyId: config.aws.accessKeyId,
  secretAccessKey: config.aws.secretAccessKey,
  region: config.aws.region,
});

exports.handler = function (event, context) {

  console.log('Received event:');
  console.log(JSON.stringify(event));
  switch (event.method) {
    case "GET":
      var queryParams = event["queryParams"];
      var challenge = queryParams["hub.challenge"];
      var verify_token = queryParams["hub.verify_token"];
      challenge.replace('\\', '');
      context.done(null, parseInt(challenge));
      break;

    case "POST":
      processPost(event, function (leadgen_array) {
        var contacts = async.map(leadgen_array, getFormData, function (err, contacts) {
          var message = prepareMessage();
          message.contacts = contacts;
          bridgContactSubscriber(message, context.done);
        });
      });
      break;

    default:
      return null;
  }
};

function processPost(event, callback) {
  var myJson = event["body"];
  var entry = myJson["entry"];
  var leadgen_array = _.map(entry, function (o) {
    return _.map(o.changes, function (s) {
      return s.value.leadgen_id
    })
  });
  var leadgen_array = _.flattenDeep(leadgen_array);
  callback(leadgen_array);
}

function refreshAccessToken(lastTokenCreatedDate) {
  var today = moment();
  var canRefreshAccessToken = false;
  if (!lastTokenCreatedDate) {
    canRefreshAccessToken = true;
  } else {
    if(fbAccessTokenValidity){

    }
  }
}

function getFormData(leadgen_id, callback) {
  var lastFbAccessTokenCreatedAt;
  var docClient = new aws.DynamoDB.DocumentClient();
  docClient.get({
    TableName: table,
    Key: {
      "client_code": clientCode
    }
  }, function (err, data) {
    if (err) {
      console.error("Unable to read item. Error JSON:", JSON.stringify(err, null, 2));
      callback(err, null);
    } else {
      apiToken = data.api_token;
      accountId = data.account_id;
      lastFbAccessTokenCreatedAt = data.access_token_created_at;
      refreshAccessToken(lastFbAccessTokenCreatedAt);
      var options = {
        method: 'GET',
        url: 'https://graph.facebook.com/v2.5/' + leadgen_id,
        qs: {
          access_token: data.Item.access_token
        },
        headers: {}
      };
      request(options, function (error, response, body) {
        if (error) {
          callback(error, null);
        } else {
          var body = JSON.parse(body);
          var fields = body["field_data"];
          var contact = _.fromPairs(fields.map(function (item) {
            return [item.name, item.values[0]];
          }));
          contact.name = contact.full_name;
          contact.zip = contact.zip_code;
          contact.mobile_phone = contact.phone_number;
          contact.source = 'Facebook_leadgen';
          contact.account_id = parseInt(accountId);
          callback(null, contact);
        }
      });
    }
  });
}

function prepareMessage() {
  return {
    accountId: parseInt(accountId),
    apiToken: apiToken,
    apiUrl: apiUrl
  };
}
