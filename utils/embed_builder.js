// 파일 위치: /utils/embed_builder.js

const { EmbedBuilder } = require('discord.js');

// --- 색상 상수 정의 ---
const COLORS = {
    SUCCESS: 0x00FA9A,      // 연한 초록 (AI 성공)
    INFO: 0x0099FF,         // 파랑 (Deep Research)
    WARN: 0xFFA500,         // 주황 (폴백, 기억 검색)
    ERROR: 0xE74C3C,         // 빨강 (오류)
    IMAGE: 0x4A90E2,         // 파랑 계열 (Imagen)
    VIDEO: 0x5865F2,         // 보라 계열 (Veo)
    EARTHQUAKE_DEFAULT: 0x808080, // 회색 (지진 기본)
    HELP: 0x0099FF          // 파랑 (도움말)
};

/**
 * 기본 Embed 틀을 생성하는 내부 헬퍼 함수
 * @param {object} options - 기본 Embed 옵션
 * @param {string} [options.title] - 제목
 * @param {string} [options.description] - 설명
 * @param {number} [options.color] - 색상
 * @param {string} [options.footerText] - Footer 텍스트 (타임스탬프 자동 추가됨)
 * @param {string} [options.imageUrl] - 이미지 URL
 * @param {Array<object>} [options.fields] - 필드 배열 ( [{ name: '...', value: '...', inline?: boolean }] )
 * @returns {EmbedBuilder} - 기본 설정된 EmbedBuilder 인스턴스
 */
function createBaseEmbed({ title, description, color, footerText, imageUrl, fields }) {
    const embed = new EmbedBuilder();

    if (title) embed.setTitle(title.substring(0, 256)); // 제목 길이 제한
    if (description) embed.setDescription(description.substring(0, 4096)); // 설명 길이 제한
    if (color) embed.setColor(color);
    if (imageUrl) embed.setImage(imageUrl);
    if (fields && Array.isArray(fields)) {
        // 필드 값 길이 제한 적용
        const limitedFields = fields.map(f => ({
            name: String(f.name).substring(0, 256),
            value: String(f.value).substring(0, 1024),
            inline: f.inline || false
        }));
        embed.addFields(limitedFields.slice(0, 25)); // 최대 25개 필드
    }

    embed.setTimestamp(); // 타임스탬프는 기본으로 추가

    if (footerText) {
        embed.setFooter({ text: String(footerText).substring(0, 2048) });
    }

    return embed;
}

/**
 * 일반적인 AI 명령어 응답 Embed 생성 (chat, deep_research 등)
 * @param {object} data - Embed 데이터
 * @param {string} [data.title] - 사용자 질문/프롬프트
 * @param {string} data.description - AI의 답변 내용
 * @param {Array<object>} [data.fields] - 추가 필드 (예: 출처)
 * @param {string} [data.footerPrefix="Powered by AI"] - Footer 앞부분 텍스트
 * @param {number} [data.duration] - 명령어 실행 시간 (밀리초)
 * @param {import('discord.js').User} [data.user] - 요청 사용자 객체
 * @param {boolean} [data.isFallback=false] - Gemini 폴백 응답 여부
 * @param {string} [data.searchQuery] - (Deep Research) 사용된 검색어
 * @returns {EmbedBuilder}
 */
function createAiResponseEmbed({ title, description, fields, footerPrefix = "Powered by AI", duration, user, isFallback = false, searchQuery }) {
    const color = isFallback ? COLORS.WARN : COLORS.SUCCESS;
    let footerText = footerPrefix;

    if (duration !== undefined) {
        const durationString = (duration / 1000).toFixed(1) + 's';
        footerText += ` | ${durationString} 소요`;
    }
    if (searchQuery) {
         footerText += ` | 검색어: "${searchQuery}"`;
    }
    if (user) {
        footerText += ` | 요청자: ${user.tag}`;
    }

    return createBaseEmbed({ title, description, fields, color, footerText });
}

/**
 * 이미지 생성(Imagen) 결과 Embed 생성
 * @param {object} data
 * @param {string} data.prompt - 사용된 프롬프트
 * @param {number} data.imageCount - 생성된 이미지 개수
 * @param {string} data.attachmentUrl - 대표 이미지 Attachment URL (예: 'attachment://gemini-image-1.png')
 * @param {number} data.duration - 명령어 실행 시간 (밀리초)
 * @param {import('discord.js').User} data.user - 요청 사용자 객체
 * @returns {EmbedBuilder}
 */
function createImageGenEmbed({ prompt, imageCount, attachmentUrl, duration, user }) {
    const title = `"${prompt.substring(0, 250)}${prompt.length > 250 ? '...' : ''}"`;
    const description = `${imageCount}개의 이미지가 생성되었습니다.`;
    const durationString = (duration / 1000).toFixed(1) + 's';
    const footerText = `Powered by Imagen | ${durationString} 소요 | 요청자: ${user.tag}`;

    return createBaseEmbed({
        title,
        description,
        color: COLORS.IMAGE,
        imageUrl: attachmentUrl,
        footerText
    });
}

/**
 * 비디오 생성(Veo) 결과 Embed 생성
 * @param {object} data
 * @param {string} data.prompt - 사용된 프롬프트
 * @param {number} data.duration - 명령어 실행 시간 (밀리초)
 * @param {import('discord.js').User} data.user - 요청 사용자 객체
 * @returns {EmbedBuilder}
 */
function createVideoGenEmbed({ prompt, duration, user }) {
    const title = `"${prompt.substring(0, 250)}${prompt.length > 250 ? '...' : ''}"`;
    const description = `영상 생성이 완료되었어! (첨부 파일 확인)`;
    const durationString = (duration / 1000).toFixed(1) + 's';
    const footerText = `Powered by Veo | ${durationString} 소요 | 요청자: ${user.tag}`;

    return createBaseEmbed({
        title,
        description,
        color: COLORS.VIDEO,
        footerText
    });
}

/**
 * 지진 정보 알림 Embed 생성 (기존 earthquake.js 로직 기반)
 * @param {object} eqData - 파싱된 지진 정보 객체 (parseEqInfoToObject 결과)
 * @returns {EmbedBuilder}
 */
function createEarthquakeEmbed(eqData) {
    const rawIntensity = eqData.jdLoc || "정보 없음";
    const embedColor = getColorByIntensity(rawIntensity); // 기존 색상 함수 재활용
    const rawTime = eqData.eqDate || "정보 없음";
    let formattedTime = "정보 없음";
    if (rawTime.length === 14) { // YYYYMMDDHHMMSS 형식 확인
         formattedTime = `${rawTime.substring(0, 4)}년 ${rawTime.substring(4, 6)}월 ${rawTime.substring(6, 8)}일 ${rawTime.substring(8, 10)}시 ${rawTime.substring(10, 12)}분 ${rawTime.substring(12, 14)}초`;
    }

    const fields = [
        { name: '📍 진원지', value: eqData.eqPt || "정보 없음", inline: true },
        { name: '⏳ 발생시각', value: formattedTime, inline: true },
        { name: '📏 규모', value: `M ${eqData.magMl || "정보 없음"}`, inline: true },
        { name: '💥 최대진도', value: rawIntensity, inline: true },
        { name: ' 깊이', value: `${eqData.eqDt || "?"}km`, inline: true }
    ];

    return createBaseEmbed({
        title: '📢 실시간 지진 정보',
        description: eqData.ReFer || "상세 정보 없음",
        color: embedColor,
        fields: fields,
        footerText: '출처: 기상청'
    });
}

/**
 * 로그 메시지 Embed 생성
 * @param {object} data
 * @param {string} data.errorMessage - 보여줄 오류 메시지
 * @param {string} [data.commandName] - 오류가 발생한 명령어 이름 (선택)
 * @param {import('discord.js').User} [data.user] - 요청 사용자 (선택)
 * @param {string} data.type - 로그 유형 (예: 'ERROR', 'WARN')
 * @returns {EmbedBuilder}
 */
function createLogEmbed({ message, commandName, user, type }) {
    const color = type === 'ERROR' ? COLORS.ERROR : (type === 'WARN' ? COLORS.WARN : COLORS.INFO);
    let title = type === 'ERROR' ? '❌ 오류 발생' : (type === 'WARN' ? '⚠️ 경고' : 'ℹ️ 정보');

    if (commandName) {
        title += ` (${commandName})`;
    }

    return createBaseEmbed({
        title,
        description: message,
        color,
        footerText: user ? `요청자: ${user.tag}` : undefined
    });
}

// --- 내부 헬퍼: 진도별 색상 결정 ---
function getColorByIntensity(rawIntensityString) {
    if (!rawIntensityString) return COLORS.EARTHQUAKE_DEFAULT;
    const upperIntensity = rawIntensityString.toUpperCase();
    if (upperIntensity.includes('Ⅹ') || upperIntensity.includes('10')) return 0x000000; // 검정
    if (upperIntensity.includes('Ⅸ') || upperIntensity.includes('IX') || upperIntensity.includes('9')) return 0x4C2600; // 매우 진한 갈색
    if (upperIntensity.includes('Ⅷ') || upperIntensity.includes('VIII') || upperIntensity.includes('8')) return 0x632523; // 진한 빨강/갈색
    if (upperIntensity.includes('Ⅶ') || upperIntensity.includes('VII') || upperIntensity.includes('7')) return 0xA32977; // 보라
    if (upperIntensity.includes('Ⅵ') || upperIntensity.includes('VI') || upperIntensity.includes('6')) return 0xFF0000; // 빨강
    if (upperIntensity.includes('Ⅴ') || upperIntensity.includes('V') || upperIntensity.includes('5')) return 0xFFC000; // 주황
    if (upperIntensity.includes('Ⅳ') || upperIntensity.includes('IV') || upperIntensity.includes('4')) return 0xFFFF00; // 노랑
    if (upperIntensity.includes('Ⅲ') || upperIntensity.includes('III') || upperIntensity.includes('3')) return 0x92D050; // 연두
    if (upperIntensity.includes('Ⅱ') || upperIntensity.includes('II') || upperIntensity.includes('2')) return 0xADE8FF; // 하늘
    if (upperIntensity.includes('Ⅰ') || upperIntensity.includes('I') || upperIntensity.includes('1')) return 0xFFFFFF; // 흰색
    return COLORS.EARTHQUAKE_DEFAULT; // 회색
}


// 필요한 함수들을 export
module.exports = {
    createBaseEmbed,
    createAiResponseEmbed,
    createImageGenEmbed,
    createVideoGenEmbed,
    createEarthquakeEmbed,
    createLogEmbed
};