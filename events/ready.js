// events/ready.js

const { Events } = require('discord.js');
const cron = require('node-cron');
const { checkEarthquakeAndNotify } = require('../utils/earthquake'); // 잠시 후 만들 파일

module.exports = {
    name: Events.ClientReady,
    once: true, // 이 이벤트는 한 번만 실행되어야 합니다.
    execute(client) {
        console.log(`Logged in as ${client.user.tag}.`);
        console.log('Bot is ready and schedulers are being set up.');

        // 1분마다 지진 정보 확인
        cron.schedule('* * * * *', checkEarthquakeAndNotify, {
            scheduled: true,
            timezone: "Asia/Seoul"
        });
        
        // 여기에 다른 cron job들도 추가할 수 있습니다.
    },
};