var Ami = {
    params: {
        url: '{$AMI.URL}',
        trunk: '{$AMI.TRUNK_REGEXP}'
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
    sip: {
        trunks: [],
        monitored_online: 0,
        monitored_offline: 0,
        unmonitored_online: 0,
        unmonitored_offline: 0,
        active_channels: 0,
        total: 0
    },
    iax: {
        trunks: [],
        online: 0,
        offline: 0,
        unmonitored: 0,
        active_channels: 0,
        total: 0
    },
    pjsip: {
        trunks: [],
        available: 0,
        unavailable: 0,
        active_channels: 0,
        total: 0
    },
    queue: {
        queues: [],
        total: 0
    }
};

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

function getSipPeers() {
    var response = Ami.request(url, 'SIPpeers'),
        elements = text2Object(response.body);
    asterisk.sip.total = elements.length;
    asterisk.sip.trunks = elements.filter(function (element) {
        return element.ObjectName.search(Ami.params.trunk) != -1;
    });
    elements.forEach(function (element) {
        if (element.IPaddress === '-none-') {
            switch (element.Status) {
                case 'Unmonitored':
                    asterisk.sip.unmonitored_offline++;
                    break;

                case 'UNKNOWN':
                    asterisk.sip.monitored_offline++;
                    break;
            }
        }
        else {
            if (element.Status === 'Unmonitored') {
                asterisk.sip.unmonitored_online++;
            }
            else {
                asterisk.sip.monitored_online++;
                if (element.Status.search('^OK') != -1) {
                    element.Status = element.Status.split(' ')[0];
                }
            }
        }
    });
    asterisk.sip.trunks.forEach(function (trunk) {
        var active_channels = channels.match(new RegExp('[^!J]SIP/' + escapeChars(trunk.ObjectName), 'g'));
        trunk.active_channels = (active_channels === null) ? 0 : active_channels.length;
        asterisk.sip.active_channels += trunk.active_channels;
    });
}

function getIaxPeerList() {
    response = Ami.request(url, 'IAXpeerlist');
    elements = text2Object(response.body);
    asterisk.iax.total = elements.length;
    asterisk.iax.trunks = elements.filter(function (element) {
        return element.ObjectName.search(Ami.params.trunk) != -1;
    });
    elements.forEach(function (element) {
        if (element.Status.search('^OK') != -1) {
            element.Status = element.Status.split(' ')[0];
        }
        switch (element.Status) {
            case 'Unmonitored':
                asterisk.iax.unmonitored++;
                break;

            case 'UNKNOWN':
                asterisk.iax.offline++;
                break;
        }
    });
    asterisk.iax.online = asterisk.iax.total - asterisk.iax.offline;
    asterisk.iax.trunks.forEach(function (trunk) {
        var active_channels = channels.match(new RegExp('[^!](IAX2/' + escapeChars(trunk.ObjectName) +
            '|IAX2/' + escapeChars(trunk.ObjectUsername) + ')', 'g'));
        trunk.active_channels = (active_channels === null) ? 0 : active_channels.length;
        asterisk.iax.active_channels += trunk.active_channels;
    });
}

function getPjsipShowEndpoints() {
    response = Ami.request(url, 'PJSIPShowEndpoints');
    elements = text2Object(response.body);
    asterisk.pjsip.total = elements.length;
    asterisk.pjsip.trunks = elements.filter(function (element) {
        return element.ObjectName.search(Ami.params.trunk) != -1;
    });

    elements.forEach(function (element) {
        if (element.DeviceState === 'Unavailable') {
            asterisk.pjsip.unavailable++;
        }
    });
    asterisk.pjsip.available = asterisk.pjsip.total - asterisk.pjsip.unavailable;
    asterisk.pjsip.trunks.forEach(function (trunk) {
        var active_channels = channels.match(new RegExp('[^!]PJSIP/' + escapeChars(trunk.ObjectName), 'g'));
        trunk.active_channels = (active_channels === null) ? 0 : active_channels.length;
        asterisk.pjsip.active_channels += trunk.active_channels;
    });
}

function getQueueSummary() {
    response = Ami.request(url, 'QueueSummary');
    asterisk.queue.queues = text2Object(response.body);
    asterisk.queue.total = asterisk.queue.queues.length;
}

function escapeChars(str) {
    return str.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
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

var cookie = value.match(/mansession_id="([0-9A-z]+)"/);
if (cookie == null) {
    throw 'Cannot find mansession_id with cookie in response.';
}

var url = Ami.params.url.split('?')[0] + '?action=';

Ami.api_request.addHeader('Cookie: mansession_id="' + cookie[1] + '"');

var response = Ami.request(url, 'CoreSettings');
var coreSettings = block2Object(response.body);
if (typeof coreSettings.AsteriskVersion !== 'undefined') {
    asterisk.version = coreSettings.AsteriskVersion;
}

response = Ami.request(url, 'command&command=core%20show%20uptime');
var uptime = block2Object(response.body);
if (typeof uptime["System uptime"] !== 'undefined') {
    asterisk.uptime = getUptimeSeconds(uptime["System uptime"]);
}
if (typeof uptime["Last reload"] !== 'undefined') {
    asterisk.uptime_reload = getUptimeSeconds(uptime["Last reload"]);
}

response = Ami.request(url, 'command&command=core%20show%20channels%20count');
channels = response.body;
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

response = Ami.request(url, 'command&command=core%20show%20channels%20concise');
channels = response.body;

response = Ami.request(url, 'ListCommands');
var list = response.body;
if (list.includes('SIPpeers')) {
    getSipPeers();
}
if (list.includes('IAXpeerlist')) {
    getIaxPeerList();
}
if (list.includes('PJSIPShowEndpoints')) {
    getPjsipShowEndpoints();
}
if (list.includes('QueueSummary')) {
    getQueueSummary();
}

try {
    response = Ami.request(url, 'Logoff');
}
catch (e) {}

return JSON.stringify(asterisk);