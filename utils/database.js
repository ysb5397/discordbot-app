const mongoose = require('mongoose');

const interactionSchema = new mongoose.Schema({
    interactionId: { type: String, required: true, unique: true },
    channelId: { type: String },
    userId: { type: String, required: true },
    userName: { type: String, required: true },
    type: {
        type: String,
        enum: ['MESSAGE', 'MENTION', 'VOICE', 'ERROR', 'EARTHQUAKE'],
        required: true
    },
    content: { type: mongoose.Schema.Types.Mixed, required: true },
    botResponse: { type: String },
    timestamp: { type: Date, default: Date.now }
});

interactionSchema.index({ userId: 1, type: 1, timestamp: -1 });


const Interaction = mongoose.model('Interaction', interactionSchema);

const connectDB = async () => {
    const mongoURI = process.env.MONGODB_URI;
    if (!mongoURI) {
        console.error('오류: MONGODB_URI 환경 변수가 설정되지 않았습니다. .env 파일을 확인해주세요.');
        return; 
    }

    try {
        await mongoose.connect(mongoURI);
        console.log('성공적으로 MongoDB에 연결되었어! ✅');
    } catch (err) {
        console.error('MongoDB 연결에 실패했어... 😭', err);
        throw err; 
    }
};

const disconnectDB = async () => {
    try {
        await mongoose.disconnect();
        console.log('MongoDB 연결이 성공적으로 종료되었어. 🛑');
    } catch (err) {
        console.error('MongoDB 연결 종료 중 오류 발생:', err);
        throw err;
    }
};

const reconnectDB = async () => {
    console.log('MongoDB 재연결을 시도합니다...');
    await disconnectDB();
    await connectDB();
};

module.exports = {
    Interaction,
    connectDB,
    disconnectDB,
    reconnectDB,
};