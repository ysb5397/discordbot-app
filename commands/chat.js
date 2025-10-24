const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { Interaction } = require('../utils/database.js');
const { generateMongoFilter, callFlowise, genAI } = require('../utils/ai_helper.js');

/**
 * 검색된 기억(interaction document)의 내용을 보기 좋게 축약하는 함수
 * @param {object} doc - MongoDB에서 가져온 Interaction document
 * @returns {string} - 100자로 축약된 내용 문자열
 */
function formatMemoryContent(doc) {
    if (typeof doc.content === 'string') {
        return doc.content.length > 100 ? doc.content.substring(0, 100) + '...' : doc.content;
    }
    const summary = doc.content.rem || '내용 없음';
    return `[${doc.type}] ${summary}`.substring(0, 100);
}

/**
 * 검색된 기억을 바탕으로 임베드를 만들어 응답하는 함수
 * @param {import('discord.js').CommandInteraction} interaction - Discord 인터랙션 객체
 * @param {Array<object>} searchResults - MongoDB에서 검색된 결과 배열
 */
async function handleMemoryFound(interaction, searchResults) {
    const userQuestion = interaction.options.getString('question');
    const sessionId = interaction.user.id;
    
    const commentPrompt = `사용자가 "${userQuestion}" 라고 질문해서 관련 기억을 찾았어. 이 상황에 대해 짧고 자연스러운 코멘트를 해줘.`;
    const aiComment = await callFlowise(commentPrompt, sessionId, 'memory-comment');

    const embed = new EmbedBuilder()
        .setTitle('혹시 이 기억들을 찾고 있었어? 🤔')
        .setColor(0xFFD700);

    const description = searchResults.map((doc, index) => {
        const content = formatMemoryContent(doc);
        const messageLink = `https://discord.com/channels/${interaction.guildId}/${doc.channelId}/${doc.interactionId}`;
        const timestamp = new Date(doc.timestamp).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        return `**${index + 1}.** [메시지 바로가기](${messageLink}) "${content}"\n*(${timestamp})*`;
    }).join('\n\n');
    
    embed.setDescription(description);

    if (aiComment) {
        embed.addFields({ name: "AI의 코멘트", value: aiComment });
    }

    await interaction.editReply({ content: `<@${sessionId}>`, embeds: [embed] });
}

/**
 * 일반적인 AI 대화를 처리하고 응답하는 함수
 * (기록이 있을 때만 history를 전송하고, Flowise 실패 시 Gemini로 폴백)
 * @param {import('discord.js').CommandInteraction} interaction - Discord 인터랙션 객체
 */
async function handleRegularConversation(interaction) {
    const userQuestion = interaction.options.getString('question');
    const sessionId = interaction.user.id;
    const attachment = interaction.options.getAttachment('file');
    const botName = interaction.client.user.username;

    const recentInteractions = await Interaction.find({ 
        userId: sessionId, 
        type: { $in: ['MESSAGE', 'MENTION'] } 
    }).sort({ timestamp: -1 }).limit(10);
    
    const history = recentInteractions.reverse().flatMap(doc => {
        const userMessage = typeof doc.content === 'string' ? doc.content : JSON.stringify(doc.content);
        const userTurn = { role: 'user', content: userMessage };
        if (doc.type === 'MENTION' && doc.botResponse) {
            return [userTurn, { role: 'assistant', content: doc.botResponse }];
        }
        return userTurn;
    });

    const requestBody = {
        question: userQuestion,
        overrideConfig: { sessionId, vars: { bot_name: botName } },
    };

    if (history.length > 0) {
        requestBody.history = history;
    }

    if (attachment) {
        const response = await fetch(attachment.url);
        if (!response.ok) throw new Error(`첨부파일을 가져오는 데 실패했습니다: ${response.statusText}`);
        const imageBuffer = Buffer.from(await response.arrayBuffer());
        requestBody.uploads = [{ data: imageBuffer.toString('base64'), type: 'file' }];
    }

    try {
        // 1. 그냥 callFlowise 호출 (이제부턴 실패해도 Gemini가 응답해줌)
        const aiResponseText = await callFlowise(requestBody, sessionId, 'chat-conversation');
        
        // 2. 무조건 성공할테니, 바로 JSON 파싱
        const aiResponse = JSON.parse(aiResponseText); 

        // 3. embed 만들기
        const replyEmbed = new EmbedBuilder()
            .setColor(aiResponse.text.includes('Flowise 에이전트 연결에 실패') ? 0xFFA500 : 0x00FA9A) // (폴백이면 주황색)
            .setDescription(aiResponse.text || 'AI로부터 답변을 받지 못했습니다.')
            .setTimestamp()
            .setFooter({ text: '⚠️ Flowise 오류로 인해 Gemini Pro (Fallback)가 응답했습니다.' });

        await interaction.editReply({ content: `<@${sessionId}>`, embeds: [replyEmbed] });

    } catch (error) {
        // 4. (이건 callFlowise가 아닌, JSON 파싱이나 editReply에서 날 수 있는 진짜 에러)
        console.error(`[Chat Command] AI 응답 처리 중 심각한 오류:`, error);
        await interaction.editReply({ content: `<@${sessionId}> 미안... 응답을 처리하다가 알 수 없는 오류가 났어. 😭` });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('chat')
        .setDescription('AI와 대화하거나, 저장된 기억을 검색합니다.')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('AI에게 할 질문 또는 검색할 내용')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('AI에게 보여줄 파일을 첨부하세요 (이미지, 코드 등).')
                .setRequired(false)),
    
    async execute(interaction) {
        await interaction.deferReply();
        const userQuestion = interaction.options.getString('question');
        const sessionId = interaction.user.id;

        try {
            const filter = await generateMongoFilter(userQuestion, sessionId);
            const searchResults = await Interaction.find(filter).sort({ timestamp: -1 }).limit(5);

            if (searchResults.length > 0) {
                await handleMemoryFound(interaction, searchResults);
            } else {
                await handleRegularConversation(interaction);
            }
        } catch (error) {
            console.error(`'/chat' 명령어 처리 중 오류 발생:`, error);
            await interaction.editReply({ content: `<@${sessionId}> 죄송합니다, 요청을 처리하는 중에 예상치 못한 오류가 발생했어요.` }).catch(console.error);
        }
    },
};