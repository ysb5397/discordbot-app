// utils/earthquake.js

const { EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');
const { Interaction } = require('./database.js'); // DB 모델 가져오기

// --- 설정 변수 ---
const EQ_API_CONFIG = {
    serviceKey: process.env.EQK_API_KEY,
    url: "http://apis.data.go.kr/1360000/EqkInfoService/getEqkMsg",
    pageNo: 1,
    numOfRows: 10,
    dataType: "XML"
};
const INITIAL_DELAY = 60 * 1000; // 1분 (기본 주기)
const MAX_DELAY = 30 * 60 * 1000; // 30분 (최대 주기)
const BACKOFF_FACTOR = 2; // 오류 발생 시 주기 증가 배수

// --- 상태 변수 ---
let currentDelay = INITIAL_DELAY;
let timeoutId = null;

// --- XML 항목을 JS 객체로 변환하는 헬퍼 함수 ---
function parseEqItemToObject(item) {
    const getText = (selector) => item.querySelector(selector)?.textContent || null;
    return {
        tmEqk: getText("tmEqk"),
        rem: getText("rem"),
        loc: getText("loc"),
        mt: getText("mt"),
        inT: getText("inT"),
        dep: getText("dep"),
        img: getText("img"),
        fcTp: getText("fcTp")
    };
}

// --- 핵심 로직: 지진 정보 확인 및 알림 ---
async function checkEarthquakeAndNotify(client) {
    console.log('[EQK] 지진 정보 확인을 시작합니다...');

    const today = new Date();
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(today.getDate() - 3);

    const formatDate = (date) => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const url = `${EQ_API_CONFIG.url}?serviceKey=****************&pageNo=${EQ_API_CONFIG.pageNo}&numOfRows=${EQ_API_CONFIG.numOfRows}&dataType=${EQ_API_CONFIG.dataType}&fromTmFc=${formatDate(threeDaysAgo)}&toTmFc=${formatDate(today)}`;

    try {
        const response = await fetch(url, { timeout: 10000 });
        if (!response.ok) {
            throw new Error(`API 요청 실패. 상태 코드: ${response.status}`);
        }
        const xmlText = await response.text();
        const dom = new JSDOM(xmlText, { contentType: "application/xml" });
        const items = dom.window.document.getElementsByTagName("item");
        
        let latestDomesticEqItem = null;
        for (const item of items) {
            const fcTp = item.querySelector("fcTp")?.textContent;
            if (fcTp === '3' || fcTp === '5') {
                latestDomesticEqItem = item;
                break;
            }
        }

        if (latestDomesticEqItem) {
            const eqTime = latestDomesticEqItem.querySelector("tmEqk")?.textContent;
            if (!eqTime) {
                console.log('[EQK] 지진 정보에 발생 시각이 없어 처리를 중단합니다.');
                return;
            }

            // 1. DB에서 해당 지진 기록이 있는지 확인 (발생 시각을 고유 ID로 사용)
            const existingEq = await Interaction.findOne({ interactionId: eqTime, type: 'EARTHQUAKE' });

            // 2. 이미 DB에 있다면, 로그만 남기고 종료
            if (existingEq) {
                console.log(`[EQK] 이미 처리된 지진 정보입니다 (시각: ${eqTime}). 건너뜁니다.`);
                return;
            }

            // 3. DB에 없다면, 알림 보내고 DB에 저장
            await sendEarthquakeAlert(latestDomesticEqItem, client);

            const newEqData = parseEqItemToObject(latestDomesticEqItem);
            const newEqInteraction = new Interaction({
                interactionId: eqTime, // 지진 발생 시각을 고유 ID로 사용
                userId: client.user.id, // 봇의 ID
                userName: client.user.username, // 봇의 이름
                type: 'EARTHQUAKE',
                content: newEqData, // 지진 정보 객체를 content에 저장
                botResponse: 'Discord alert sent.'
            });
            await newEqInteraction.save();
            console.log(`[EQK] 새로운 지진 정보를 DB에 저장했습니다 (시각: ${eqTime}).`);

        } else {
            console.log('[EQK] 최근 3일간 국내 지진 정보가 없습니다.');
        }
    } catch (error) {
        console.error('[EQK] 지진 정보 처리 중 오류 발생:', error.message);
        throw error;
    }
}

// --- 스케줄러 로직 ---
async function scheduleCheck(client) {
    try {
        await checkEarthquakeAndNotify(client);
        if (currentDelay !== INITIAL_DELAY) {
            console.log(`[EQK] 지진 정보 확인 성공. 확인 주기를 ${INITIAL_DELAY / 1000}초로 초기화합니다.`);
            currentDelay = INITIAL_DELAY;
        }
    } catch (error) {
        currentDelay = Math.min(currentDelay * BACKOFF_FACTOR, MAX_DELAY);
        console.warn(`[EQK] 지진 정보 확인 실패. 다음 확인까지 ${currentDelay / 1000}초 대기합니다.`);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => scheduleCheck(client), currentDelay);
    }
}

// --- 부가 함수: 임베드 생성 및 전송 ---
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
        const channel = await client.channels.fetch(targetChannelId);
        if (channel && channel.isTextBased()) {
            await channel.send({ embeds: [embed] });
            console.log(`[EQK] 채널(${targetChannelId})에 지진 정보를 성공적으로 전송했습니다.`);
        } else {
            throw new Error(`ID(${targetChannelId})에 해당하는 채널을 찾을 수 없거나 텍스트 채널이 아닙니다.`);
        }
    } catch (error) {
        console.error('[EQK] Discord 메시지 전송 중 오류 발생:', error);
        // DB 저장을 막기 위해 에러를 다시 던짐
        throw error;
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

// --- 외부 노출 함수 ---
function startEarthquakeMonitor(client) {
    if (!process.env.EQK_API_KEY) {
        console.warn('[EQK] EQK_API_KEY가 설정되지 않아 지진 정보 모니터링을 시작할 수 없습니다.');
        return;
    }
    console.log('[EQK] 지진 정보 모니터링을 시작합니다.');
    scheduleCheck(client); // 첫 확인 시작
}

module.exports = {
    startEarthquakeMonitor
};
