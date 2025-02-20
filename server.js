const express = require('express');
const twilio = require('twilio');
const http = require('http');
const { Server } = require('ws');
const { GoogleAuth } = require('google-auth-library');
const speech = require('@google-cloud/speech');
const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs');
const { exec } = require('child_process');
require('dotenv').config();

// 🔥 Ensure Google Cloud Credentials Path is Set
process.env.GOOGLE_APPLICATION_CREDENTIALS = "./google-credentials.json";

const app = express();
const server = http.createServer(app);
const wss = new Server({ server });

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, SERVER_URL, RECEIVER_PHONE_NUMBER, OPENAI_API_KEY } = process.env;
const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

app.use(express.json());

// 📞 Initiate a Call
app.post('/call-user', async (req, res) => {
    try {
        const call = await client.calls.create({
            url: `${SERVER_URL}/voice-response`,
            to: RECEIVER_PHONE_NUMBER,
            from: TWILIO_PHONE_NUMBER
        });
        console.log(`📞 Call initiated: ${call.sid}`);
        res.json({ success: true });
    } catch (error) {
        console.error("❌ Error initiating call:", error);
        res.status(500).json({ error: "Failed to place call" });
    }
});

// 📢 Twilio XML Response to Connect WebSocket
app.post('/voice-response', (req, res) => {
    console.log("📞 Incoming call from Twilio");

    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say("Hello! Welcome to Biltmore Hair Restoration. How can I assist you today?");
    
    // ⏸️ Prevent Twilio from hanging up too early
    twiml.pause({ length: 5 });

    twiml.connect().stream({
        url: `wss://${SERVER_URL.replace(/^https?:\/\//, '')}/ws`,
        track: "inbound_track"
    });

    console.log("🛠️ Twilio Stream URL:", `${SERVER_URL}/ws`);
    
    res.type('text/xml').send(twiml.toString());
});

// 🎤 WebSocket Server for Streaming Audio
wss.on('connection', (ws) => {
    console.log("🔗 WebSocket Connected! Waiting for audio input...");

    const speechClient = new speech.SpeechClient();
    const request = {
        config: {
            encoding: 'MULAW',
            sampleRateHertz: 8000,
            languageCode: 'en-US',
        },
        interimResults: false,
    };

    const recognizeStream = speechClient
        .streamingRecognize(request)
        .on('error', (err) => console.error("🎙️ Speech-to-Text Error:", err))
        .on('data', async (data) => {
            if (!data.results[0] || !data.results[0].alternatives[0]) {
                console.warn("⚠️ Warning: No valid transcription detected.");
                return;
            }

            const transcript = data.results[0].alternatives[0].transcript;
            console.log(`🗣 User said: ${transcript}`);

            if (transcript.trim() !== "") {
                const aiResponse = await getAIResponse(transcript);
                console.log(`🤖 AI Response: ${aiResponse}`);

                const audioPath = await synthesizeSpeech(aiResponse);
                console.log(`🎧 AI Audio Response Generated: ${audioPath}`);

                const audioData = fs.readFileSync(audioPath);
                // WAV files have a 44-byte header. Strip it before sending.
                const rawAudioData = audioData.slice(44);  

                console.log(`📤 Sending ${rawAudioData.length} bytes of clean MULAW audio to Twilio`);
                ws.send(rawAudioData);
            }
        });

    ws.on('message', (message) => {
        console.log(`🔊 Received ${message.length} bytes of audio from Twilio`);

        // Save raw audio data for debugging
        fs.appendFileSync(`twilio-audio.raw`, message);

        if (message.length < 100) {
            console.warn("⚠️ Warning: Audio data from Twilio is very small. Might be silent.");
        }

        recognizeStream.write(message);
    });

    ws.on('close', () => {
        console.log("❌ WebSocket Disconnected!");
        recognizeStream.end();

        // Convert and debug the received audio
        console.log("🔍 Converting Twilio audio for debugging...");
        exec(`ffmpeg -f mulaw -ar 8000 -ac 1 -i twilio-audio.raw twilio-audio.wav`, (err, stdout, stderr) => {
            if (err) {
                console.error("❌ FFmpeg Conversion Error:", err);
            } else {
                console.log("✅ Twilio Audio Saved as `twilio-audio.wav`");
                console.log("🎧 Play the file with: `ffplay -autoexit twilio-audio.wav`");
            }
        });
    });

    ws.on('error', (error) => console.error("⚠️ WebSocket Error:", error));
});

// ✅ WebSocket Debugging Route
app.get('/ws', (req, res) => {
    res.send("WebSocket is running");
});

// 🧠 AI Processing (Using OpenAI API)
async function getAIResponse(text) {
    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "gpt-4o",
                messages: [{ role: "system", content: `You are an AI assistant for Biltmore Hair Restoration. Answer customer questions about hair transplant procedures and services.` }, { role: "user", content: text }],
                temperature: 0.7
            })
        });

        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        console.error("❌ AI Error:", error);
        return "I'm sorry, I couldn't process that request.";
    }
}

// 🎙️ Convert AI Response to Speech (Google TTS)
async function synthesizeSpeech(text) {
    const ttsClient = new textToSpeech.TextToSpeechClient();
    const request = {
        input: { text },
        voice: { languageCode: "en-US", ssmlGender: "NEUTRAL" },
        audioConfig: { audioEncoding: "LINEAR16" },
    };

    const [response] = await ttsClient.synthesizeSpeech(request);
    const filePath = `output.mp3`;
    fs.writeFileSync(filePath, response.audioContent, 'binary');
    return filePath;
}

// ✅ Start Server
server.listen(3000, () => console.log("✅ Server running on port 3000"));
