/**
 * A simple XMPP client bot aimed specifically at Google Talk
 * @author Simon Holywell <simon@holywell.com.au>
 * @author Luiz Tiago (luiztiago@gmail.com)
 */

const config = require('./config.js').settings;
const xmpp = require('node-xmpp');
const request_helper = require('request');
const util = require('util');

const conn = new xmpp.Client(config.client);
conn.socket.setTimeout(0);
conn.socket.setKeepAlive(true, 10000);

var commands = {};

/**
 * Request the roster from the Google identity query service
 * http://code.google.com/apis/talk/jep_extensions/roster_attributes.html#3
 */
function request_google_roster() {
	var roster_elem = new xmpp.Element('iq', { from: conn.jid, type: 'get', id: 'google-roster'})
						.c('query', { xmlns: 'jabber:iq:roster', 'xmlns:gr': 'google:roster', 'gr:ext': '2' });
	conn.send(roster_elem);
}

/**
 * Accept any subscription request stanza that is sent over the wire
 * @param {Object} stanza
 */
function accept_subscription_requests(stanza) {
	if(stanza.is('presence') 
	   && stanza.attrs.type === 'subscribe') {
		var subscribe_elem = new xmpp.Element('presence', {
			to: stanza.attrs.from,
			type: 'subscribed'
		});
		conn.send(subscribe_elem);
		util.log("[accepted] user: " + stanza.attrs.from);
	}
}

/**
* Only function to trim any string
* @param {string} str
*/
function trim(str){
	return str.replace(/^\s+|\s+$/g,"");
}

/**
 * Set the status message of the bot to the supplied string
 * @param {String} status_message
 */
function set_status_message(status_message) {
	var presence_elem = new xmpp.Element('presence', { })
								.c('show').t('chat').up()
								.c('status').t(status_message);
	conn.send(presence_elem);
}

/**
 * Send a message to the supplied JID
 * @param {String} to_jid
 * @param {String} message_body
 */
function send_message(to_jid, message_body) {
	var elem = new xmpp.Element('message', { to: to_jid, type: 'chat' })
				 .c('body').t(message_body);
	conn.send(elem);
	util.log('[message] SENT: ' + elem.up().toString());
}

/**
 * A wrapper for send message to wrap the supplied command in help
 * text
 */
function send_unknown_command_message(request) {
	send_message(request.stanza.attrs.from, 'Unknown command: "' + request.command + '". Type "help" for more information.');
}

/**
 * Send out some help information detailing the available
 * bot commands
 * @param {String} to_jid
 */
function send_help_information(to_jid) {
	var message_body = "Currently 'md5', 'twitter' and 'weather' are supported:\n";
	// message_body += "b:example text\n";
	message_body += "md5:some string to convert to md5\n";
	message_body += "t:some search string on twitter\n";
	// message_body += "s:a new status message\n";
	message_body += "w:city to verify today's weather\n";
	send_message(to_jid, message_body);
}

/**
 * Break the message up into components
 * @param {Object} stanza
 */
function split_request(stanza) {
	var message_body = stanza.getChildText('body');
	if(null !== message_body) {
		message_body = message_body.split(config.command_argument_separator);
		var command = message_body[0].trim().toLowerCase();
		if('help' === command || '?' == command) {
			send_help_information(stanza.attrs.from);
		} else if(typeof message_body[1] !== "undefined") {
			return { "command" : command,
					 "argument": message_body[1].trim(),
					 "stanza"  : stanza };
		}
	}
	return false;
}

function md5(string) {
	var crypto = require('crypto'),
		string = trim(string),
		hash = crypto.createHash('md5').update(string).digest("hex");
	return hash;
}

/**
 * Dispatch requests sent in message stanzas
 * @param {Object} message
 */
function reply_message(message, jid) {
	if(message) {
		var params = message.split(":");
		switch(trim(params[0])) {
			case 'md5':
				send_message(jid, md5(params[1]));
				break;
			case 'twitter':
			case 't':
				twitter(params[1], jid);
				break;
			case 'w':
			case 'weather':
				weather(params[1], jid);
				break;
			default:
				send_message(jid, message + " (mode anti-forever alone)");
				break;
		}
	}
}

/**
 * Dispatch requests sent in message stanzas
 * @param {Object} stanza
 */
function message_dispatcher(stanza) {
	if('error' === stanza.attrs.type) {
		util.log('[error] ' + stanza.toString());
	} else if(stanza.is('message')) {

		// var text = stanza.getChildText('body'),
		// 	jid = stanza.attrs.from;
		// reply_message(text, jid);

		var request = split_request(stanza);
		if(request) {
			if(!execute_command(request)) {
				send_unknown_command_message(request);
			}
		}
	}

}

function twitter(search, to_jid){
	search = trim(search);
	send_message(to_jid, 'Searching "'+search+'" on twitter...');
	var url = 'http://search.twitter.com/search.json?rpp=5&show_user=true&q='
			 + encodeURIComponent(search);
	request_helper(url, function(error, response, body){
		if (!error && response.statusCode == 200) {
			var body = JSON.parse(body);
			if(body.results.length) {
				for(var i in body.results) {
					var message = "@" + body.results[i].from_user + ": " + body.results[i].text;
					send_message(to_jid, message);
				}
			} else {
				send_message(to_jid, 'There are no results for your query. Please try again.');
			}
		} else {
			send_message(to_jid, 'Twitter was unable to provide a satisfactory response. Please try again.');
		}
	});
	return true;
}

function weather(search, to_jid){
	search = trim(search);
	send_message(to_jid, 'Searching "'+search+'" on Yahoo Weather...');
	var url = 'http://query.yahooapis.com/v1/public/yql?q=select%20*%20from%20weather.bylocation%20where%20location%3D%22'
			 + encodeURIComponent(search)+"%22%20and%20unit%3D%22c%22&diagnostics=true&format=json&env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys";
	request_helper(url, function(error, response, body){
		//console.log(response);
		body = JSON.parse(body);
		// console.log(body);
		// console.log("--------------------------")
		var item = body.query.results.weather.rss.channel.item,
			title = item.title,
			temp = item.condition.temp,
			text = item.condition.text,
			message_body;

		message_body = title + "\n";
		message_body += temp + "ºC - " + text;
		send_message(to_jid, message_body);
	});
	return true;
}

/**
 * Add a command to the bot for processing
 * @param {String} command
 * @param {Function} callback (should return true on success)
 */
function add_command(command, callback) {
	commands[command] = callback;
}

/**
 * Execute a command
 * @param {Object} request
 */
function execute_command(request) {
	if(typeof commands[request.command] === "function") {
		return commands[request.command](request);
	}
	return false;
}

/**
 * Bounce any message the user sends to the bot back to them
 * @param {Object} request
 */
add_command('b', function(request) {
	send_message(request.stanza.attrs.from, request.stanza.getChildText('body'));
	return true;
});

/**
 * Search twitter for the provided term and give back 5 tweets
 * @param {Object} request
 */
add_command('t', function(request) {
	var to_jid = request.stanza.attrs.from,
		search = request.argument;
	twitter(search, to_jid);
	// send_message(to_jid, 'Searching twitter, please be patient...');
	// var url = 'http://search.twitter.com/search.json?rpp=5&show_user=true&lang=en&q='
	// 		 + encodeURIComponent(request.argument);
	// request_helper(url, function(error, response, body){
	// 	if (!error && response.statusCode == 200) {
	// 		var body = JSON.parse(body);
	// 		if(body.results.length) {
	// 			for(var i in body.results) {
	// 				send_message(to_jid, body.results[i].text);
	// 			}
	// 		} else {
	// 			send_message(to_jid, 'There are no results for your query. Please try again.');
	// 		}
	// 	} else {
	// 		send_message(to_jid, 'Twitter was unable to provide a satisfactory response. Please try again.');
	// 	}
	// });
	return true;
});

/**
 * Set the bot's status message to the provided term
 * @param {Object} request
 */
add_command('s', function(request) {
	set_status_message(request.argument);
	return true;
});

/**
 * Send md5 hash to client
 * @param {Object} request
 */
add_command('md5', function(request) {
	md5(request.argument);
	return true;
});

if(config.allow_auto_subscribe) {
	// allow the bot to respond to subscription requests
	// and automatically accept them if enabled in the config
	conn.addListener('online', request_google_roster);
	conn.addListener('stanza', accept_subscription_requests);
}

conn.addListener('stanza', message_dispatcher);

conn.on('online', function() {
	set_status_message(config.status_message);
});

conn.on('error', function(stanza) {
	util.log('[error] ' + stanza.toString());
});
