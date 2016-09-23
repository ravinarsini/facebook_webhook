'use strict';

var bridgNodeSdk = require('bridg-node-sdk');
var config = require('config');
var lodash = require('lodash');
var async = require('async');
var url = require('url');

/**
 * Subscribes list of contacts from message
 * using public endpoint in Bridg Contacts API (saveFromPublic)
 *
 * @param message - message should contain account, api url, api Token
 *                  and list of contacts to be subscribed
 * @param complete  callback function
 */
module.exports = function(message, complete) {

  var apiUrl = message.apiUrl;

  var bridg = new bridgNodeSdk({
    accountId: message.accountId,
    apiKey: message.apiToken,
    apiUrl: apiUrl,
    timeout: 40000
  });

  var MAX_ATTEMPTS = config.aws.contactSubscriber.maxAttempts;

  function subscribeContact(contact, wait, attempts, callback) {
    var jsonpCallback = null;

    getBridgContactByEmail(contact.email, 0, 3, function(bridgContact) {
      if (bridgContact.count > 0) {
        if (bridgContact.contact.opt_out != null && bridgContact.contact.opt_out[0] === 1) {
          console.log('opt_out is 1 so resubscribing new contact');
          bridg.Contacts.resubscribe(bridgContact.contact.id, "facebook_leadgen_webhook", callback);
        } else {
          console.log('already contact is avaliable');
          callback();
        }
      } else {
        bridg.Contacts.saveContactPublic(
          contact,
          jsonpCallback,
          function(error, result, response) {
            attempts++;
            if (attempts >= MAX_ATTEMPTS) {
              console.log("Subscribing contacts failed after " + attempts + " attempts");
              return callback(null);
            }
            //console.log('\n error in subscribing contact '+ JSON.stringify(error) + '\n');
            if (error && (error.code === 'ETIMEDOUT' || error.code == '504')) {
              wait += 1000 * 3;
              console.info("request timed out, retrying in " + wait + "ms");
              return setTimeout(function() {
                subscribeContact(contact, wait, attempts, callback);
              }, wait);
            } else if (error) {
              console.error(error.message, ' ', contact.email);
            } else {
              console.log('subscribed ' + contact.email);
            }
            callback(null);
          }
        );
      }
    });


  }

  /**
   * Get the contact with the given email address, within the authenticated account
   *
   * @param email
   * @returns {Promise} A Bluebird.js promise
   */
  var getBridgContactByEmail = function(email, getContactWait, getContactAttempts, complete) {
    bridg.Contacts.getContactByEmail(
      email,
      function(error, result, HttpResponse) {
        getContactAttempts++;
        if (getContactAttempts >= MAX_ATTEMPTS) {
          console.error("getting contact details failed after " + getContactAttempts + " attempts");
          return complete(result);
        }
        if (error && (error.code === 'ETIMEDOUT' || error.code == '504')) {
          getContactWait += 1000 * 3;
          console.info("request timed out, retrying in " + getContactWait + "ms");
          return setTimeout(function() {
            getBridgContactByEmail(email, getContactWait, getContactAttempts, complete);
          }, getContactWait);
        } else if (error) {
          console.error("Error occurred while getting bridg contact for " + email + " " + JSON.stringify(error));
          console.error(HttpResponse);
          console.error(error.stack);
          return complete(result);
        } else {
          return complete(result);
        }
      });
  };

  /**
   * Saves contacts to Bridg API to save in sys_contact table.
   *
   * @param contacts  The contacts to be saved in sys_contact table.
   * @param complete  a callback function.
   *
   * NOTES: uses public save endpoint  (saveFromPublic) in bridg contact API
   * to save contacts in sys_contact table.
   */
  function sendContacts(contacts, complete) {
    async.eachSeries(
      contacts,
      function(contact, callback) {
        var wait = 0;
        var attempts = 0;
        subscribeContact(contact, wait, attempts, callback);
      },
      function(err) {
        complete();
      });
  }

  sendContacts(message.contacts, function() {
    complete();
  });
};
