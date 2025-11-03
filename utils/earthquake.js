const { createEarthquakeEmbed } = require('./embed_builder.js');
const { JSDOM } = require('jsdom');
const { Interaction } = require('./database.js');

// --- 설정 변수 ---
const EQ_API_CONFIG = {
    url: "https://apihub.kma.go.kr/api/typ09/url/eqk/urlNewNotiEqk.do",
    authKey: process.env.EQK_AUTH_KEY,
    orderTy: "xml",
    orderCm: "L"
};
const INITIAL_DELAY = 60 * 1000; // 1분 (기본 주기)
const MAX_DELAY = 30 * 60 * 1000; // 30분 (최대 주기)
const BACKOFF_FACTOR = 2; // 오류 발생 시 주기 증가 배수

let currentDelay = INITIAL_DELAY;
let timeoutId = null;
let earthquakeMonitorStatus = '초기화 중...';

// XML을 변환하는 헬퍼 함수
function parseEqInfoToObject(info) {
    const getText = (selector) => info.querySelector(selector)?.textContent || null;
    return {
        msgCode: getText("msgCode"),
        cntDiv: getText("cntDiv"),
        arDiv: getText("arDiv"),
        eqArCdNm: getText("eqArCdNm"),
        eqPt: getText("eqPt"),
        nkDiv: getText("nkDiv"),
        tmIssue: getText("tmIssue"),
        eqDate: getText("eqDate"),
        magMl: getText("magMl"),
        magDiff: getText("magDiff"),
        eqDt: getText("eqDt"),
        eqLt: getText("eqLt"),
        eqLn: getText("eqLn"),
        jdLoc: getText("jdLoc"),
        ReFer: getText("ReFer"),
    };
}

async function checkEarthquakeAndNotify(client) {
    console.log('[EQK] 지진 정보 확인을 시작합니다 (기상청 직접 호출)...');

    const url = `${EQ_API_CONFIG.url}?orderTy=${EQ_API_CONFIG.orderTy}&orderCm=${EQ_API_CONFIG.orderCm}&authKey=${EQ_API_CONFIG.authKey}`;

    try {
        const response = await fetch(url, { timeout: 10000 });
        if (!response.ok) {
            throw new Error(`API 요청 실패. 상태 코드: ${response.status}`);
        }
        const xmlText = await response.text();
        const dom = new JSDOM(xmlText, { contentType: "application/xml" });
        
        const eqInfo = dom.window.document.querySelector("info");

        if (!eqInfo) {
            console.log('[EQK] 유효한 지진 정보(<info>)를 찾을 수 없습니다.');
            return;
        }

        const eqTime = eqInfo.querySelector("eqDate")?.textContent;
        if (!eqTime) {
            console.log('[EQK] 지진 정보에 발생 시각이 없어 처리를 중단합니다.');
            return;
        }

        const existingEq = await Interaction.findOne({ interactionId: eqTime, type: 'EARTHQUAKE' });

        if (existingEq) {
            console.log(`[EQK] 이미 처리된 지진 정보입니다 (시각: ${eqTime}). 건너뜁니다.`);
            return;
        }

        await sendEarthquakeAlert(eqInfo, client);

        const newEqData = parseEqInfoToObject(eqInfo);
        const newEqInteraction = new Interaction({
            interactionId: eqTime,
            userId: client.user.id,
            userName: client.user.username,
            type: 'EARTHQUAKE',
            content: newEqData,
            botResponse: 'Discord alert sent.'
        });
        await newEqInteraction.save();
        console.log(`[EQK] 새로운 지진 정보를 DB에 저장했습니다 (시각: ${eqTime}).`);

    } catch (error) {
        console.error('[EQK] 지진 정보 처리 중 오류 발생:', error.message);
        throw error;
    }
}

async function scheduleCheck(client) {
    try {
        await checkEarthquakeAndNotify(client);
        earthquakeMonitorStatus = '정상';
        if (currentDelay !== INITIAL_DELAY) {
            console.log(`[EQK] 지진 정보 확인 성공. 확인 주기를 ${INITIAL_DELAY / 1000}초로 초기화합니다.`);
            currentDelay = INITIAL_DELAY;
        }
    } catch (error) {
        earthquakeMonitorStatus = error.message.includes('상태 코드:') ? `오류 ${error.message.split(' ').pop()}` : '오프라인';
        currentDelay = Math.min(currentDelay * BACKOFF_FACTOR, MAX_DELAY);
        console.warn(`[EQK] 지진 정보 확인 실패. 다음 확인까지 ${currentDelay / 1000}초 대기합니다.`);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => scheduleCheck(client), currentDelay);
    }
}

async function sendEarthquakeAlert(info, client) {
    const targetChannelId = '1388443793589538899';
    const rawIntensity = info.querySelector("jdLoc")?.textContent || "정보 없음";
    const rawTime = info.querySelector("eqDate")?.textContent || "정보 없음"; // tmEqk -> eqDate

    const embed = createEarthquakeEmbed({
        jdLoc: rawIntensity,
        eqDate: rawTime,
        magMl: info.querySelector("magMl")?.textContent || "정보 없음",
        eqPt: info.querySelector("eqPt")?.textContent || "정보 없음",
        eqDt: info.querySelector("eqDt")?.textContent || "정보 없음",
        ReFer: info.querySelector("ReFer")?.textContent || "상세 정보 없음"
    });

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
        throw error;
    }
}

function startEarthquakeMonitor(client) {
    if (!process.env.EQK_AUTH_KEY) {
        earthquakeMonitorStatus = '키 없음';
        console.warn('[EQK] EQK_AUTH_KEY가 설정되지 않아 지진 정보 모니터링을 시작할 수 없습니다.');
        return;
    }
    console.log('[EQK] 지진 정보 모니터링을 시작합니다.');
    scheduleCheck(client);
}

module.exports = {
    startEarthquakeMonitor,
    get earthquakeMonitorStatus() {
        return earthquakeMonitorStatus;
    }
};