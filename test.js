import axios from "axios";

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
        // total: 0,

        // trunks: [],
        // available: 0,
        // unavailable: 0,
        // active_channels: 0,

    },

};

const axiosInstance = axios.create();

axiosInstance.interceptors.response.use(
    // Получаем куки из ответа
    response => {
        const cookies = response.headers['set-cookie'];

        // Если есть куки, устанавливаем их в заголовки для последующих запросов
        if (cookies && cookies.length > 0) {
            axiosInstance.defaults.headers.common['Cookie'] = cookies.map(cookie => cookie.split(":")[0]).join(": ");
        }

        return response;
    },
    error => Promise.reject(error)
)

const block2Object = (text) => {
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

const sendAMIRequest =  async  (action, command = null) => {
    try {
        // console.log(`:: start action : ${action}`)
        let params=  {
            action: action,
        }
        if (action === "Login") {
            params.username = amiConfig.username;
            params.secret = amiConfig.secret
        }
        if (action === "command"){
            params.command = command;
        }

        const { data } = await axiosInstance.get(amiConfig.url, {params});
        return data;
    } catch(error) {
        console.error(error)
    }
}

// usage
const start = async () => {
    // login asterisk AMI
    await sendAMIRequest("Login");

    await sendAMIRequest("PJSIPShowRegistrationInboundContactStatuses").then(res => {
        const contacts = text2Object(res)
        console.log(res)
        console.log(contacts)

        contacts.map((item) => {
            if (item?.AOR){
                asterisk.pjsip.total += 1
                // extension 1XXXXX
                if (item?.AOR && new RegExp(/^1\d{5}$/).test(item.AOR)) {
                    asterisk.pjsip.outdoor_intercoms += 1;
                }
                // extension 4XXXXXXXXX
                if (item?.AOR && new RegExp(/^4\d{9}$/).test(item.AOR)) {
                    asterisk.pjsip.client_intercoms += 1;
                }
                // extension 7XXXXXXXXX
                if (item?.AOR && new RegExp(/^7\d{9}$/).test(item.AOR)) {
                    asterisk.pjsip.client_webrtc += 1;
                }
            }

        })
    });

    // get asterisk version
    await sendAMIRequest("CoreSettings")
        .then((res)=>{
            const coreSettings = block2Object(res)
            if (coreSettings && coreSettings?.AsteriskVersion){
                asterisk.version = coreSettings?.AsteriskVersion
            }
        });

    // get asterisk uptime
    await sendAMIRequest("command", "core show uptime")
        .then(res => {
            const object = block2Object(res)
            if  (object['System uptime'] !== undefined){
                asterisk.uptime = getUptimeSeconds(object['System uptime'])
            }
            if  (object['Last reload'] !== undefined){
                asterisk.uptime_reload = getUptimeSeconds(object['Last reload'])
            }
        })

    // get asterisk channels information
    await sendAMIRequest("command", "core show channels count")
        .then((res)=>{
            let fields = {
                active_channels: 'active channels?',
                active_calls: 'active calls?',
                calls_processed: 'calls? processed'
            }

            Object.keys(fields).forEach(function (field) {
                const match = res.match('(\\d+) ' + fields[field]);
                if (match !== null && typeof match[1] !== 'undefined') {
                    asterisk[field] = parseInt(match[1]);
                }
            });

        })


}

start()
    .finally( async () => await sendAMIRequest("Logoff"))
    .then(()=>console.log(asterisk))
