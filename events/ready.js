// events/ready.js

const { Events } = require('discord.js');
const cron = require('node-cron');
const { checkEarthquakeAndNotify } = require('../utils/earthquake');

module.exports = {
    name: Events.ClientReady,
    once: true,
    // client를 마지막 인자로 받도록 수정
    execute(client) {
        console.log(`Logged in as ${client.user.tag}.`);
        console.log('Bot is ready and schedulers are being set up.');

        // 1분마다 지진 정보 확인, client 객체 전달
        cron.schedule('* * * * *', () => checkEarthquakeAndNotify(client), {
            scheduled: true,
            timezone: "Asia/Seoul"
        });
    },
};