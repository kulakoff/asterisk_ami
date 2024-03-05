import http from 'https';

const amiConfig = {
    url: process.env.ARI_URL,
    username: process.env.ARI_USERNAME,
    secret: process.env.ARI_PASSWORD
};

const asterisk = {
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

let cookies = ''; // Для хранения кук

const block2Object = (text) => {
    let parts = [],
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

const block2Object_debug = (text) => {
    let parts = [],
        dict = {};

    text = text.replace(/^Output: /gm, '');
    console.log(text)

    text.split('\n').forEach(function (line) {
        parts = line.split(':');
        if (parts.length > 1) {
            dict[parts.shift().trim()] = parts.join(':').trim();
        }
    })

    return dict;
}

const text2Object = (text) => {
    var blocks = text.split('\r\n\r\n'),
        arr = [],
        i = 1,
        j = blocks.length - 2;

    for (i; i < j; i++) {
        arr.push(block2Object(blocks[i]));
    }

    return arr;
}

const getUptimeSeconds = (text) => {
    const date = {
        years: 0,
        weeks: 0,
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0
    };

    const fields = {
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

const sendAMIRequest = async (action, command = null) => {
    return new Promise((resolve, reject) => {
        let url = amiConfig.url + '?action=' + action;
        if (action === "Login") {
            url += '&username=' + amiConfig.username + '&secret=' + amiConfig.secret;
        }
        if (action === "command") {
            url += '&command=' + encodeURIComponent(command);
        }

        const options = {
            method: 'GET',
            headers: {
                'Cookie': cookies
            }
        };

        const req = http.request(url, options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                // Сохраняем куки из ответа
                cookies = res.headers['set-cookie'] || cookies;

                resolve(data);
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.end();
    });
}

const start = async () => {
    // login asterisk AMI
    await sendAMIRequest("Login");

    // TODO: done
    //  PJSIP contacts
    const contactsRes = await sendAMIRequest("PJSIPShowRegistrationInboundContactStatuses");
    const contacts = text2Object(contactsRes);

    contacts.map((item) => {
        if (item?.AOR) {
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

    // TODO: done
    //  CoreSettings
    const coreSettingsRes = await sendAMIRequest("CoreSettings");
    const coreSettings = block2Object(coreSettingsRes);
    if (coreSettings && coreSettings.AsteriskVersion) {
        asterisk.version = coreSettings.AsteriskVersion;
    }

    // TODO: done
    //  uptime
    const uptimeRes = await sendAMIRequest("command", "core show uptime");
    const uptime = block2Object(uptimeRes);
    if (uptime['System uptime'] !== undefined) {
        asterisk.uptime = getUptimeSeconds(uptime['System uptime']);
    }
    if (uptime['Last reload'] !== undefined) {
        asterisk.uptime_reload = getUptimeSeconds(uptime['Last reload']);
    }


    const channelsRes = await sendAMIRequest("command", "core show channels count");
    let fields = {
        active_channels: 'active channels?',
        active_calls: 'active calls?',
        calls_processed: 'calls? processed'
    }

    Object.keys(fields).forEach(function (field) {
        const match = channelsRes.match('(\\d+) ' + fields[field]);
        if (match !== null && typeof match[1] !== 'undefined') {
            asterisk[field] = parseInt(match[1]);
        }
    });


    // logoff asterisk AMI
    await sendAMIRequest("Logoff");
    console.log(asterisk);
}

start();
