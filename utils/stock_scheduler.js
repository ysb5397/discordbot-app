const cron = require('node-cron');
const { analyzeStock } = require('./ai_helper.js');
const { createBaseEmbed } = require('./embed_builder.js');
const { AttachmentBuilder } = require('discord.js');
const config = require('../config/manage_environments.js');

const TARGET_CHANNEL_ID = config.channels.stockNotice;

const TARGET_STOCKS = ["삼성전자", "엔비디아", "테슬라", "구글"];

async function startStockAnalysisSchedule(client) {
    cron.schedule('0 6 * * *', async () => {
        console.log('📈 [Stock Scheduler] 모닝 주식 브리핑 시작...');

        const channel = await client.channels.fetch(TARGET_CHANNEL_ID).catch(() => null);
        if (!channel) {
            console.error(`❌ [Stock Scheduler] 타겟 채널(${TARGET_CHANNEL_ID})을 찾을 수 없습니다.`);
            return;
        }

        await channel.send(`🌅 **좋은 아침이야!**오늘의 시장 상황을 분석하고 있어. 잠시만 기다려줘! ☕ (약 1~2분 소요)`);

        for (const stockName of TARGET_STOCKS) {
            try {
                console.log(`🔍 [Stock Scheduler] ${stockName} 분석 중...`);

                const result = await analyzeStock(stockName);

                const { ticker, report, chart_image } = result;

                const chartBuffer = Buffer.from(chart_image, 'base64');
                const chartAttachment = new AttachmentBuilder(chartBuffer, { name: `${ticker}_chart.png` });

                const embed = createBaseEmbed({
                    title: `📊 ${stockName} (${ticker}) 아침 브리핑`,
                    description: report, // AI가 작성한 마크다운 리포트
                    color: 0x00FA9A, // 주식 상승 느낌의 초록색
                    imageUrl: `attachment://${ticker}_chart.png`,
                    footerText: "Daily Morning Stock Briefing by AI Agent"
                });

                // 전송
                await channel.send({ embeds: [embed], files: [chartAttachment] });

                // 다음 요청 전 딜레이 (API 부하 방지)
                await new Promise(resolve => setTimeout(resolve, 5000));

            } catch (error) {
                console.error(`❌ [Stock Scheduler] ${stockName} 분석 실패:`, error);
                await channel.send(`⚠️ **${stockName}** 분석 중 오류가 발생했어: ${error.message}`);
            }
        }

        await channel.send(`✅ **오늘의 브리핑 끝!** 성투해! 🚀`);
        console.log('📈 [Stock Scheduler] 브리핑 완료.');

    }, {
        timezone: "Asia/Seoul"
    });

    console.log('✅ [Scheduler] 주식 브리핑 스케줄러가 등록되었습니다. (매일 06:00)');
}

module.exports = { startStockAnalysisSchedule };