// utils/earthquake.js

const { EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');
const dotenv = require('dotenv');

dotenv.config();

const EQ_API_CONFIG = {
    serviceKey: process.env.EQK_API_KEY,
    url: "http://apis.data.go.kr/1360000/EqkInfoService/getEqkMsg",
    pageNo: 1,
    numOfRows: 10,
    dataType: "XML"
};

let lastEarthquakeTime = null;

// client를 인자로 받도록 수정
async function checkEarthquakeAndNotify(client) {
    console.log('[EQK] 지진 정보 확인을 시작합니다...');

    const today = new Date();
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(today.getDate() - 3);

    const formatDate = (date) => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const url = `${EQ_API_CONFIG.url}?serviceKey=${EQ_API_CONFIG.serviceKey}&pageNo=${EQ_API_CONFIG.pageNo}&numOfRows=${EQ_API_CONFIG.numOfRows}&dataType=${EQ_API_CONFIG.dataType}&fromTmFc=${formatDate(threeDaysAgo)}&toTmFc=${formatDate(today)}`;

    try {
        const response = await fetch(url, { timeout: 10000 });
        if (!response.ok) {
            console.error(`[EQK] API 요청 실패. 상태 코드: ${response.status}`);
            return;
        }
        const xmlText = await response.text();
        const dom = new JSDOM(xmlText, { contentType: "application/xml" });
        const items = dom.window.document.getElementsByTagName("item");
        
        let latestDomesticEq = null;
        for (const item of items) {
            const fcTp = item.querySelector("fcTp")?.textContent;
            if (fcTp === '3' || fcTp === '5') {
                latestDomesticEq = item;
                break;
            }
        }

        if (latestDomesticEq) {
            const eqTime = latestDomesticEq.querySelector("tmEqk")?.textContent;
            if (eqTime && eqTime === lastEarthquakeTime) {
                console.log('[EQK] 새로운 지진 정보가 없습니다.');
                return;
            }
            lastEarthquakeTime = eqTime;
            // client 객체 전달
            await sendEarthquakeAlert(latestDomesticEq, client);
        } else {
            console.log('[EQK] 최근 3일간 국내 지진 정보가 없습니다.');
        }
    } catch (error) {
        console.error('[EQK] 지진 정보 처리 중 오류 발생:', error);
    }
}

function getColorByIntensity(rawIntensityString) {
    if (!rawIntensityString) return 0x808080;
    const upperIntensity = rawIntensityString.toUpperCase();
    if (upperIntensity.includes('Ⅹ') || upperIntensity.includes('10')) return 0x000000;
    if (upperIntensity.includes('Ⅸ') || upperIntensity.includes('IX') || upperIntensity.includes('9')) return 0x4C2600;
    if (upperIntensity.includes('Ⅷ') || upperIntensity.includes('VIII') || upperIntensity.includes('8')) return 0x632523;
    if (upperIntensity.includes('Ⅶ') || upperIntensity.includes('VII') || upperIntensity.includes('7')) return 0xA32977;
    if (upperIntensity.includes('Ⅵ') || upperIntensity.includes('VI') || upperIntensity.includes('6')) return 0xFF0000;
    if (upperIntensity.includes('Ⅴ') || upperIntensity.includes('V') || upperIntensity.includes('5')) return 0xFFC000;
    if (upperIntensity.includes('Ⅳ') || upperIntensity.includes('IV') || upperIntensity.includes('4')) return 0xFFFF00;
    if (upperIntensity.includes('Ⅲ') || upperIntensity.includes('III') || upperIntensity.includes('3')) return 0x92D050;
    if (upperIntensity.includes('Ⅱ') || upperIntensity.includes('II') || upperIntensity.includes('2')) return 0xADE8FF;
    if (upperIntensity.includes('Ⅰ') || upperIntensity.includes('I') || upperIntensity.includes('1')) return 0xFFFFFF;
    return 0x808080;
}

// client를 인자로 받도록 수정
async function sendEarthquakeAlert(item, client) {
    const targetChannelId = '1388443793589538899';
    const rawIntensity = item.querySelector("inT")?.textContent || "정보 없음";
    const intensityValue = rawIntensity.split('(')[0];
    const embedColor = getColorByIntensity(intensityValue);
    const rawTime = item.querySelector("tmEqk")?.textContent || "정보 없음";
    const formattedTime = `${rawTime.substring(0, 4)}년 ${rawTime.substring(4, 6)}월 ${rawTime.substring(6, 8)}일 ${rawTime.substring(8, 10)}시 ${rawTime.substring(10, 12)}분`;

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle('📢 실시간 국내 지진 정보')
        .setDescription(item.querySelector("rem")?.textContent || "상세 정보 없음")
        .addFields(
            { name: '📍 진원지', value: item.querySelector("loc")?.textContent || "정보 없음", inline: true },
            { name: '⏳ 발생시각', value: formattedTime, inline: true },
            { name: '📏 규모', value: `M ${item.querySelector("mt")?.textContent || "정보 없음"}`, inline: true },
            { name: '💥 최대진도', value: rawIntensity, inline: true },
            { name: ' 깊이', value: `${item.querySelector("dep")?.textContent || "?"}km`, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: '출처: 기상청' });

    const imageUrl = item.querySelector("img")?.textContent;
    if (imageUrl) embed.setImage(imageUrl);

    try {
        // 인자로 받은 client 사용
        const channel = await client.channels.fetch(targetChannelId);
        if (channel && channel.isTextBased()) {
            await channel.send({ embeds: [embed] });
            console.log(`[EQK] 채널(${targetChannelId})에 지진 정보를 성공적으로 전송했습니다.`);
        } else {
            console.error(`[EQK] ID(${targetChannelId})에 해당하는 채널을 찾을 수 없거나 텍스트 채널이 아닙니다.`);
        }
    } catch (error) {
        console.error('[EQK] Discord 메시지 전송 중 오류 발생:', error);
    }
}

module.exports = {
    checkEarthquakeAndNotify
};