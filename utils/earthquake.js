// utils/earthquake.js

const { EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');

// ... (기존 index.js에 있던 EQ_API_CONFIG, lastEarthquakeTime 변수,
//      getColorByIntensity, sendEarthquakeAlert, checkEarthquakeAndNotify 함수들을
//      그대로 복사해서 여기에 붙여넣습니다.) ...
// 중복 알림 방지를 위해 마지막으로 전송한 지진의 발생 시각을 저장하는 변수
// API 설정 (서비스 키는 환경 변수로 관리하는 것이 더 안전하지만, 일단 기존 코드 구조를 따름)
const EQ_API_CONFIG = {
    serviceKey: process.env.EQK_API_KEY,
    url: "http://apis.data.go.kr/1360000/EqkInfoService/getEqkMsg",
    pageNo: 1,
    numOfRows: 10,
    dataType: "XML"
};

let lastEarthquakeTime = null;

/**
 * 1분마다 API를 호출하여 지진 정보를 확인하고 Discord에 알림을 보냅니다.
 */
async function checkEarthquakeAndNotify() {
    console.log('[EQK] 지진 정보 확인을 시작합니다...');

    // 1. API 호출을 위한 날짜 생성
    const today = new Date();
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(today.getDate() - 3);

    const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}${month}${day}`;
    };
    
    const url = `${EQ_API_CONFIG.url}?serviceKey=${EQ_API_CONFIG.serviceKey}&pageNo=${EQ_API_CONFIG.pageNo}&numOfRows=${EQ_API_CONFIG.numOfRows}&dataType=${EQ_API_CONFIG.dataType}&fromTmFc=${formatDate(threeDaysAgo)}&toTmFc=${formatDate(today)}`;

    try {
        // 2. API 데이터 요청 (fetch 사용)
        const response = await fetch(url, { timeout: 10000 }); // 10초 타임아웃
        if (!response.ok) {
            console.error(`[EQK] API 요청 실패. 상태 코드: ${response.status}`);
            return;
        }
        const xmlText = await response.text();

        // 3. XML 데이터 파싱
        const dom = new JSDOM(xmlText, { contentType: "application/xml" });
        const xmlDoc = dom.window.document;

        const items = xmlDoc.getElementsByTagName("item");
        let latestDomesticEq = null;

        for (const item of items) {
            const fcTp = item.querySelector("fcTp")?.textContent;
            if (fcTp === '3' || fcTp === '5') {
                latestDomesticEq = item;
                break; // 최신 국내 지진 정보를 찾으면 중단
            }
        }
        
        // 4. 최신 국내 지진 정보가 있으면 Embed 메시지 생성 및 전송
        if (latestDomesticEq) {
            const eqTime = latestDomesticEq.querySelector("tmEqk")?.textContent;

            // 이전에 보낸 지진 정보와 동일하면 무시 (중복 방지)
            if (eqTime && eqTime === lastEarthquakeTime) {
                console.log('[EQK] 새로운 지진 정보가 없습니다.');
                return;
            }
            
            // 새로운 정보이므로 마지막 지진 시간 갱신 및 알림 전송
            lastEarthquakeTime = eqTime;
            await sendEarthquakeAlert(latestDomesticEq);
        } else {
            console.log('[EQK] 최근 3일간 국내 지진 정보가 없습니다.');
        }

    } catch (error) {
        console.error('[EQK] 지진 정보 처리 중 오류 발생:', error.name === 'AbortError' ? 'Request Timeout' : error);
    }
}

/**
 * 지진 진도 문자열을 분석하여 지정된 색상 코드를 유연하게 반환하는 함수
 * @param {string} rawIntensityString - API에서 받은 원본 진도 문자열 (예: "Ⅴ(경북)", "진도 4")
 * @returns {number} - 16진수 색상 코드
 */
function getColorByIntensity(rawIntensityString) {
    // 입력값이 없거나 비어있으면 기본 회색 반환
    if (!rawIntensityString) {
        console.log(`[Color] Received empty or null intensity string.`);
        return 0x808080;
    }

    // 대소문자 구분 없이 비교하기 위해 모두 대문자로 변경
    const upperIntensity = rawIntensityString.toUpperCase();

    // 진도 10부터 1까지 순서대로 확인 (높은 숫자 우선)
    if (upperIntensity.includes('Ⅹ+') || upperIntensity.includes('10')) {
        return 0x000000; // 검정
    } else if (upperIntensity.includes('Ⅸ') || upperIntensity.includes('IX') || upperIntensity.includes('9')) {
        return 0x4C2600; // 진한 갈색
    } else if (upperIntensity.includes('Ⅷ') || upperIntensity.includes('VIII') || upperIntensity.includes('8')) {
        return 0x632523; // 갈색
    } else if (upperIntensity.includes('Ⅶ') || upperIntensity.includes('VII') || upperIntensity.includes('7')) {
        return 0xA32977; // 보라
    } else if (upperIntensity.includes('Ⅵ') || upperIntensity.includes('VI') || upperIntensity.includes('6')) {
        return 0xFF0000; // 빨강
    } else if (upperIntensity.includes('Ⅴ') || upperIntensity.includes('V') || upperIntensity.includes('5')) {
        return 0xFFC000; // 주황
    } else if (upperIntensity.includes('Ⅳ') || upperIntensity.includes('IV') || upperIntensity.includes('4')) {
        return 0xFFFF00; // 노랑
    } else if (upperIntensity.includes('Ⅲ') || upperIntensity.includes('III') || upperIntensity.includes('3')) {
        return 0x92D050; // 연한 초록
    } else if (upperIntensity.includes('Ⅱ') || upperIntensity.includes('II') || upperIntensity.includes('2')) {
        return 0xADE8FF; // 연한 파랑
    } else if (upperIntensity.includes('Ⅰ') || upperIntensity.includes('I') || upperIntensity.includes('1')) {
        return 0xFFFFFF; // 흰색
    } else {
        // 어떤 진도 값과도 일치하지 않을 경우
        console.log(`[Color] Unknown intensity value received: '${rawIntensityString}'`);
        return 0x808080; // 기본 회색
    }
}

/**
 * 파싱된 지진 정보를 받아 Discord Embed 메시지로 만들어 전송하는 함수
 * @param {Element} item - 파싱된 'item' XML 요소
 */
async function sendEarthquakeAlert(item) {
    const targetChannelId = '1388443793589538899'; // ❗ 채널 ID 확인 필요

    const rawIntensity = item.querySelector("inT")?.textContent || "정보 없음";
    
    // ✨[추가]✨ 진도 문자열에서 로마 숫자 부분만 추출 (예: "Ⅴ(경북)" -> "Ⅴ")
    const intensityValue = rawIntensity.split('(')[0]; 

    // ✨[추가]✨ 위에서 만든 함수를 호출하여 진도에 맞는 색상 가져오기
    const embedColor = getColorByIntensity(intensityValue);

    const rawTime = item.querySelector("tmEqk")?.textContent || "정보 없음";
    const formattedTime = `${rawTime.substring(0,4)}년 ${rawTime.substring(4,6)}월 ${rawTime.substring(6,8)}일 ${rawTime.substring(8,10)}시 ${rawTime.substring(10,12)}분`;

    const embed = new EmbedBuilder()
        .setColor(embedColor) // ✨[수정]✨ 하드코딩된 색상 대신 변수를 사용
        .setTitle('📢 실시간 국내 지진 정보')
        .setDescription(item.querySelector("rem")?.textContent || "상세 정보 없음")
        .addFields(
            { name: '📍 진원지', value: item.querySelector("loc")?.textContent || "정보 없음", inline: true },
            { name: '⏳ 발생시각', value: formattedTime, inline: true },
            { name: '📏 규모', value: `M ${item.querySelector("mt")?.textContent || "정보 없음"}`, inline: true },
            { name: '💥 최대진도', value: rawIntensity, inline: true }, // 전체 진도 정보 표시
            { name: ' 깊이', value: `${item.querySelector("dep")?.textContent || "?"}km`, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: '출처: 기상청' });

    const imageUrl = item.querySelector("img")?.textContent;
    if (imageUrl) {
        embed.setImage(imageUrl);
    }

    try {
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

// 마지막에 함수들을 내보내줍니다.
module.exports = {
    checkEarthquakeAndNotify,
};