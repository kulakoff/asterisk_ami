var Ami = {
    params: {
        url: '{$AMI.URL}',
    },
    api_request: new HttpRequest(),
    request: function (url, action) {
        url += action;
        Zabbix.log(4, '[ Asterisk ] Sending request: ' + url);
        try {
            response = Ami.api_request.get(url);
        } catch (error) {
            Zabbix.log(4, '[ Asterisk ] Get request returned error ' + error);
            throw 'Get request returned error ' + error + '. Check debug log for more information.';
        }
        Zabbix.log(4, '[ Asterisk ] Received response with status code ' +
            Ami.api_request.getStatus() + '\n' + response);
        if (Ami.api_request.getStatus() !== 200) {
            var message = 'Request failed with status code ' + Ami.api_request.getStatus();
            if (response !== null) {
                if (typeof response.message === 'string') {
                    message += ': ' + response.message;
                }
            }
            throw message + ' Check debug log for more information.';
        }
        var match = response.match('Response: (.+)');
        if (match !== null && match[1] !== 'Success' && match[1] !== 'Goodbye' && match[1] !== 'Follows') {
            var responseText = match[1],
                message = 'Request failed with message ' + match[1];
            match = response.match('Message: (.+)');
            if (match !== null && match[1]) {
                var responseMessage = match[1];
                message += ': ' + match[1];
            }
            if (responseText !== 'Error' || responseMessage !== 'No endpoints found') {
                throw message + '. Check debug log for more information.';
            }
        }
        return {
            status: Ami.api_request.getStatus(),
            body: response
        };
    }
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
// utils
function block2Object(text) {
    var parts = [],
        dict = {};
    text = text.replace(/^Output: /gm, '');
    text.split('\n').forEach(function (line) {
        parts = line.split(':');
        if (parts.length > 1) {
            dict[parts.shift().trim()] = parts.join(':').trim();
        }
    })
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

//get cookie from login action
var cookie = value.match(/mansession_id="([0-9A-z]+)"/);
if (cookie == null) {
    throw 'Cannot find mansession_id with cookie in response.';
}

var url = Ami.params.url.split('?')[0] + '?action=';

Ami.api_request.addHeader('Cookie: mansession_id="' + cookie[1] + '"');

//  action CoreSettings
function getCoreSettings() {
    var response = Ami.request(url, 'CoreSettings');
    var coreSettings = block2Object(response.body);
    if (typeof coreSettings.AsteriskVersion !== 'undefined') {
        asterisk.version = coreSettings.AsteriskVersion;
    }
}
function getUptime() {
    var response = Ami.request(url, 'command&command=core%20show%20uptime');
    var uptime = block2Object(response.body);
    if (typeof uptime["System uptime"] !== 'undefined') {
        asterisk.uptime = getUptimeSeconds(uptime["System uptime"]);
    }
    if (typeof uptime["Last reload"] !== 'undefined') {
        asterisk.uptime_reload = getUptimeSeconds(uptime["Last reload"]);
    }
}
function getChannels() {
    var response = Ami.request(url, 'command&command=core%20show%20channels%20count');
    var channels = response.body;
    var fields = {
        active_channels: 'active channels?',
        active_calls: 'active calls?',
        calls_processed: 'calls? processed'
    };

    Object.keys(fields).forEach(function (field) {
        var match = channels.match('(\\d+) ' + fields[field]);
        if (match !== null && typeof match[1] !== 'undefined') {
            asterisk[field] = parseInt(match[1]);
        }
    });
}

function getPjsipClients() {
    var response = Ami.request(url, 'PJSIPShowRegistrationInboundContactStatuses');
    var elements = text2Object(response.body);
    elements.map(function (item) {
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
}

getCoreSettings()
getUptime()
getChannels()
getPjsipClients()

return JSON.stringify(asterisk)