const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
require('dotenv').config();

const path = require('path');
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Servir o front-end estático (index.html e recursos no mesmo diretório)
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;

if (!OPENAI_API_KEY) {
  console.warn('⚠️ OPENAI_API_KEY não definido em .env. Tentaremos fallback para Hugging Face se HUGGINGFACE_API_KEY estiver configurado.');
}
if (!HUGGINGFACE_API_KEY) {
  console.warn('⚠️ HUGGINGFACE_API_KEY não definido em .env. Detect-hf e fallback pode falhar.');
}

app.post('/api/detect-openai', async (req, res) => {
  const { text = '' } = req.body;
  if (!text.trim()) return res.status(400).json({ error: 'Texto obrigatório' });

  if (!OPENAI_API_KEY) {
    if (!HUGGINGFACE_API_KEY) {
      return res.status(400).json({ error: 'Nenhuma chave de API disponível. Defina OPENAI_API_KEY ou HUGGINGFACE_API_KEY em .env.' });
    }

    // fallback para Hugging Face quando OpenAI não está configurada
    try {
      const hfResponse = await fetch('https://api-inference.huggingface.co/models/roberta-large-openai-detector', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${HUGGINGFACE_API_KEY}`
        },
        body: JSON.stringify({ inputs: text })
      });
      const data = await hfResponse.json();
      if (!hfResponse.ok) {
        return res.status(502).json({ error: 'Hugging Face API error', detail: data });
      }

      // converter resposta para formato ai_score/human_score se possível
      const aiItem = data.find((i) => /ai|gpt/i.test(i.label));
      const humanItem = data.find((i) => /human/i.test(i.label));
      return res.json({
        ai_score: aiItem?.score ? Math.round(aiItem.score * 100) : 0,
        human_score: humanItem?.score ? Math.round(humanItem.score * 100) : 0,
        reason: aiItem ? `Detectado: ${aiItem.label} (${(aiItem.score*100).toFixed(1)}%)` : 'Resultado do modelo' 
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Erro interno (fallback HF)', message: err.message });
    }
  }

  try {
    const prompt = `Você é um detector de texto gerado por IA. Retorne apenas um JSON válido com chaves: ai_score, human_score, reason. ai_score é % de probabilidade de ser IA; human_score é % de humano; reason é uma frase curta explicando.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: `Texto: "${text}"` }
        ],
        temperature: 0.0,
        max_tokens: 140
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(502).json({ error: 'OpenAI API error', detail: data });
    }

    const content = data?.choices?.[0]?.message?.content || '';
    const raw = content.replace(/```json|```/gi, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      // fallback: tentar extrair números com regex simplificada
      const aiMatch = raw.match(/ai_score\D*([0-9]+(\.[0-9]+)?)/i);
      const humanMatch = raw.match(/human_score\D*([0-9]+(\.[0-9]+)?)/i);
      parsed = {
        ai_score: aiMatch ? Number(aiMatch[1]) : 0,
        human_score: humanMatch ? Number(humanMatch[1]) : 0,
        reason: raw.slice(0, 250)
      };
    }

    return res.json(parsed);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro interno', message: err.message });
  }
});

app.post('/api/detect-hf', async (req, res) => {
  const { text = '' } = req.body;
  if (!text.trim()) return res.status(400).json({ error: 'Texto obrigatório' });
  const endpoint = 'https://api-inference.huggingface.co/models/roberta-large-openai-detector';

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${HUGGINGFACE_API_KEY}`
      },
      body: JSON.stringify({ inputs: text })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(502).json({ error: 'Hugging Face API error', detail: data });
    }

    return res.json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro interno', message: err.message });
  }
});

const PORT = process.env.PORT || 5173;
app.listen(PORT, () => console.log(`Backend rodando em http://localhost:${PORT}`));
