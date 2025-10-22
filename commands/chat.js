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
        // --- 4A. (기본) Flowise 에이전트 호출 시도 ---
        console.log(`[Flowise] '${sessionId}'님의 질문으로 에이전트 호출 시도...`);
        const aiResponseText = await callFlowise(requestBody, sessionId, 'chat-conversation');
        const flowiseResponse = JSON.parse(aiResponseText);

        const replyEmbed = new EmbedBuilder()
            .setColor(0x00FA9A)
            .setDescription(flowiseResponse.text || 'AI로부터 답변을 받지 못했습니다.')
            .setTimestamp()
            .setFooter({ text: '해당 결과는 AI(Flowise)에 의해 생성되었으며, 항상 정확한 결과를 도출하지 않습니다.' });

        if (flowiseResponse.imageUrl) {
            replyEmbed.setImage(flowiseResponse.imageUrl);
        }

        await interaction.editReply({ content: `<@${sessionId}>`, embeds: [replyEmbed] });

    } catch (flowiseError) {
        // --- 4B. (폴백) Flowise 실패 시 Gemini Pro 직접 호출 ---
        console.error(`[Flowise] 에이전트 호출 실패. Gemini (Pro) 폴백으로 전환합니다.`, flowiseError);
        await interaction.editReply({ content: `<@${sessionId}> 앗, Flowise 에이전트 연결에 실패했어. 😵\n잠시만, Gemini 기본 모델로 다시 시도해 볼게...` });

        try {
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" }); 
            const result = await model.generateContent(userQuestion);
            const fallbackResponse = result.response.text();

            const fallbackEmbed = new EmbedBuilder()
                .setColor(0xFFA500)
                .setDescription(fallbackResponse || 'Gemini 폴백 응답을 받지 못했습니다.')
                .setTimestamp()
                .setFooter({ text: '⚠️ Flowise 오류로 인해 Gemini Pro (Fallback)가 응답했습니다.' });

            await interaction.editReply({ content: `<@${sessionId}>`, embeds: [fallbackEmbed] });

        } catch (geminiError) {
            console.error(`[Gemini Fallback] 폴백조차 실패...`, geminiError);
            await interaction.editReply({ content: `<@${sessionId}> 미안... Flowise도, Gemini 폴백도 모두 실패했어... 😭` });
        }
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