import fetch from 'node-fetch';

const amiConfig = {
    url: process.env.ARI_URL,
    username: process.env.ARI_USERNAME,
    secret: process.env.ARI_PASSWORD
};


let asterisk = {
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
    const lines = text.split('\r\n');
    const obj = {};

    for (const line of lines) {
        const parts = line.split(': ');
        if (parts.length === 2) {
            obj[parts[0]] = parts[1];
        }
    }
    return obj;
}

const text2Object = (text) => {
    const blocks = text.split('\r\n\r\n');
    const objects = [];

    for (const block of blocks) {
        const obj = block2Object(block);
        objects.push(obj);
    }
    return objects;
}

const getUptimeSeconds = (text) => {
    const match = text.match(/(\d+)\syears?,\s(\d+)\sweeks?,\s(\d+)\sdays?,\s(\d+):(\d+):(\d+)/);
    if (match) {
        const [, years, weeks, days, hours, minutes, seconds] = match;
        return parseInt(years) * 31536000 + parseInt(weeks) * 604800 + parseInt(days) * 86400 +
            parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds);
    }
    return 0;
}

const sendAMIRequest = async (action, command = null) => {
    try {
        let url = amiConfig.url + '?action=' + action;
        if (action === "Login") {
            url += '&username=' + amiConfig.username + '&secret=' + amiConfig.secret;
        }
        if (action === "command") {
            url += '&command=' + encodeURIComponent(command);
        }

        const response = await fetch(url, {
            headers: { 'Cookie': cookies }
        });

        const data = await response.text();
        console.log("RESPONSE >>> "+ action.toUpperCase())
        console.log(data)

        // Сохраняем куки из ответа
        const responseCookies = response.headers.get('set-cookie');
        if (responseCookies) {
            cookies = responseCookies;
        }

        return data;
    } catch (error) {
        console.error(error);
    }
}

const start = async () => {
    // login asterisk AMI
    await sendAMIRequest("Login");

    await sendAMIRequest("PJSIPShowRegistrationInboundContactStatuses").then(res => {
        console.log(res)
        const contacts = text2Object(res);

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
        })
    });

    await sendAMIRequest("CoreSettings").then(res => {
        const coreSettings = block2Object(res);
        if (coreSettings && coreSettings.AsteriskVersion) {
            asterisk.version = coreSettings.AsteriskVersion;
        }
    });

    await sendAMIRequest("command", "core show uptime").then(res => {
        const object = block2Object(res);
        if (object['System uptime'] !== undefined) {
            asterisk.uptime = getUptimeSeconds(object['System uptime']);
        }
        if (object['Last reload'] !== undefined) {
            asterisk.uptime_reload = getUptimeSeconds(object['Last reload']);
        }
    });

    await sendAMIRequest("command", "core show channels count").then(res => {
        const object = block2Object(res);
        if (object['Active channels'] !== undefined) {
            asterisk.active_channels = parseInt(object['Active channels']);
        }
        if (object['Active calls'] !== undefined) {
            asterisk.active_calls = parseInt(object['Active calls']);
        }
        if (object['Calls processed'] !== undefined) {
            asterisk.calls_processed = parseInt(object['Calls processed']);
        }
    });
}

start()
    .finally( async () => await sendAMIRequest("Logoff"))
    .then(()=>console.log(asterisk))
