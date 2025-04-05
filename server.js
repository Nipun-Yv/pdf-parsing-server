const express = require("express");
const cors = require("cors");
const { randomUUID } = require('crypto');
const multer = require("multer");
const pdfParse = require("pdf-parse");
const dotenv=require("dotenv")
const {OpenAI} =require("openai")
const {DataAPIClient}=require("@datastax/astra-db-ts") 
dotenv.config()

const port=process.env.PORT|| 4000
const app=express()
const upload = multer({ storage: multer.memoryStorage() });

const {ASTRA_DB_PDF_COLLECTION,OPENAI_API_KEY,ASTRA_DB_NAMESPACE,ASTRA_DB_COLLECTION,ASTRA_DB_API_ENDPOINT,ASTRA_DB_TOKEN}=process.env

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const client=new DataAPIClient(ASTRA_DB_TOKEN)
const db=client.db(ASTRA_DB_API_ENDPOINT,{namespace:ASTRA_DB_NAMESPACE})

app.use(cors({origin:"*"}))

function splitTextWithOverlap(text, chunkSize = 800, overlap = 200) {
    const sentences = text.match(/[^\.!\?]+[\.!\?]+/g) || [text];
    const chunks = [];
    let chunk = "";
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      if ((chunk + sentence).length >= chunkSize) {
        chunks.push(chunk.trim());
        chunk = chunk.slice(-overlap) + sentence;
      } else {
        chunk += sentence;
      }
    }
    if (chunk.trim()) {
      chunks.push(chunk.trim());
    }
    return chunks;
  }

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const fileName=file.originalname
    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }
    const uniqueID=randomUUID()
    const pdfCollection=db.collection(ASTRA_DB_PDF_COLLECTION)

    await pdfCollection.insertOne({
        pdf_id:uniqueID,
        pdf_name:fileName
    })

    const data = await pdfParse(file.buffer);
    const chunks = splitTextWithOverlap(data.text);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embeddingRes = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: chunk,
      });
      await db.collection(ASTRA_DB_COLLECTION).insertOne({
        $vector: embeddingRes.data[0].embedding,
        text:chunk,
        pdf_id:uniqueID
      });

      if(i%5==0){
        console.log("Loading chunk...")
      }
    }
    const cursor=pdfCollection.find({},
        {
            limit:10
        }
    )
    const pdfList=await cursor.toArray()
    res.json({message:"Successful!",pdfList})
  } catch (error) {
    console.error('PDF parsing error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port,()=>{
    console.log(`Server running successfully and receiving requests from port ${port}`)
})
