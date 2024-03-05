var http = require('http');
var url = require('url');

var amiConfig = {
    url: '{$AMI.URL}'
};

var asterisk = {
    version: '',
    uptime: 0,
    uptime_reload: 0,
    active_channels: 0,
    active_calls: 0,
    calls_processed: 0,
    pjsip: {
        client_intercoms: 0,
        outdoor_intercoms: 0,
        client_webrtc: 0,
        total: 0,
    }
};

var cookies = '';

function block2Object(text) {
    var parts = [],
        dict = {};

    text = text.replace(/^Output: /gm, '');

    text.split('\n').forEach(function (line) {
        parts = line.split(':');
        if (parts.length > 1) {
            dict[parts.shift().trim()] = parts.join(':').trim();
        }
    });

    return dict;
}

function text2Object(text) {
    var blocks = text.split('\r\n\r\n'),
        arr = [],
        i = 1,
        j = blocks.length - 2;

    for (i; i < j; i++) {
        arr.push(block2Object(blocks[i]));
    }

    return arr;
}

function getUptimeSeconds(text) {
    var date = {
        years: 0,
        weeks: 0,
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0
    };

    var fields = {
        years: 'years?',
        weeks: 'weeks?',
        days: 'days?',
        hours: 'hours?',
        minutes: 'minutes?',
        seconds: 'seconds?'
    };

    Object.keys(fields).forEach(function (field) {
        var match = text.match('(\\d+) ' + fields[field]);
        if (match !== null && typeof match[1] !== 'undefined') {
            date[field] = parseInt(match[1]);
        }
    });
    return date.years * 220752000 + date.weeks * 604800 + date.days * 86400 +
        date.hours * 3600 + date.minutes * 60 + date.seconds;
}

function sendAMIRequest(action, command) {
    return new Promise(function (resolve, reject) {
        var uri = amiConfig.url + '?action=' + action;
        if (action === "Login") {
            uri += '&username=' + amiConfig.username + '&secret=' + amiConfig.secret;
        }
        if (action === "command") {
            uri += '&command=' + encodeURIComponent(command);
        }

        var options = url.parse(uri);
        options.headers = {
            'Cookie': cookies
        };
        options.method = 'GET';

        var req = http.request(options, function (res) {
            var data = '';

            res.on('data', function (chunk) {
                data += chunk;
            });

            res.on('end', function () {
                cookies = res.headers['set-cookie'] || cookies;
                resolve(data);
            });
        });

        req.on('error', function (error) {
            reject(error);
        });

        req.end();
    });
}

function start() {
    sendAMIRequest("Login")
        .then(function () {
            return sendAMIRequest("PJSIPShowRegistrationInboundContactStatuses");
        })
        .then(function (contactsRes) {
            var contacts = text2Object(contactsRes);

            contacts.map(function (item) {
                if (item && item.AOR) {
                    asterisk.pjsip.total += 1;
                    if (/^1\d{5}$/.test(item.AOR)) {
                        asterisk.pjsip.outdoor_intercoms += 1;
                    }
                    if (/^4\d{9}$/.test(item.AOR)) {
                        asterisk.pjsip.client_intercoms += 1;
                    }
                    if (/^7\d{9}$/.test(item.AOR)) {
                        asterisk.pjsip.client_webrtc += 1;
                    }
                }
            });
        })
        .then(function () {
            return sendAMIRequest("CoreSettings");
        })
        .then(function (coreSettingsRes) {
            var coreSettings = block2Object(coreSettingsRes);
            if (coreSettings && coreSettings.AsteriskVersion) {
                asterisk.version = coreSettings.AsteriskVersion;
            }
        })
        .then(function () {
            return sendAMIRequest("command", "core show uptime");
        })
        .then(function (uptimeRes) {
            var uptime = block2Object(uptimeRes);
            if (uptime['System uptime'] !== undefined) {
                asterisk.uptime = getUptimeSeconds(uptime['System uptime']);
            }
            if (uptime['Last reload'] !== undefined) {
                asterisk.uptime_reload = getUptimeSeconds(uptime['Last reload']);
            }
        })
        .then(function () {
            return sendAMIRequest("command", "core show channels count");
        })
        .then(function (channelsRes) {
            var channels = block2Object(channelsRes);
            var fields = {
                active_channels: 'active channels?',
                active_calls: 'active calls?',
                calls_processed: 'calls? processed'
            };

            Object.keys(fields).forEach(function (field) {
                var match = channelsRes.match('(\\d+) ' + fields[field]);
                if (match !== null && typeof match[1] !== 'undefined') {
                    asterisk[field] = parseInt(match[1]);
                }
            });
        })
        .then(function () {
            return sendAMIRequest("Logoff");
        })
        .then(function () {
            console.log(JSON.stringify(asterisk));
        })
        .catch(function (error) {
            console.error(error);
        });
}

start();
