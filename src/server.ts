import express from 'express';
import path from 'path';
import fs from 'fs';
import { runScraper, ScraperProgress } from './scraper';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../src/web')));

// Store active scraping sessions
const sessions: Map<string, {
    status: 'running' | 'completed' | 'error';
    progress: ScraperProgress | null;
    result: any;
    error: string | null;
}> = new Map();

// Start scraping endpoint
app.post('/api/scrape', async (req, res) => {
    const { links, outputFolder } = req.body;

    if (!links || !Array.isArray(links) || links.length === 0) {
        return res.status(400).json({ error: 'No links provided' });
    }

    // Use default output folder if not specified
    const folder = outputFolder || path.join(process.cwd(), 'output');

    // Create session ID
    const sessionId = Date.now().toString();

    sessions.set(sessionId, {
        status: 'running',
        progress: null,
        result: null,
        error: null
    });

    // Start scraping in background
    (async () => {
        try {
            const result = await runScraper(links, folder, (progress) => {
                const session = sessions.get(sessionId);
                if (session) {
                    session.progress = progress;
                }
            });

            const session = sessions.get(sessionId);
            if (session) {
                session.status = 'completed';
                session.result = result;
            }
        } catch (error) {
            const session = sessions.get(sessionId);
            if (session) {
                session.status = 'error';
                session.error = (error as Error).message;
            }
        }
    })();

    res.json({ sessionId });
});

// Get scraping progress
app.get('/api/progress/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    res.json(session);
});

// List output files
app.get('/api/files', (req, res) => {
    const outputDir = path.join(process.cwd(), 'output');

    if (!fs.existsSync(outputDir)) {
        return res.json({ files: [] });
    }

    const files = fs.readdirSync(outputDir)
        .filter(f => f.endsWith('.xlsx'))
        .map(f => ({
            name: f,
            path: `/api/download/${f}`,
            size: fs.statSync(path.join(outputDir, f)).size,
            created: fs.statSync(path.join(outputDir, f)).birthtime
        }))
        .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

    res.json({ files });
});

// Download file
app.get('/api/download/:filename', (req, res) => {
    const filePath = path.join(process.cwd(), 'output', req.params.filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    res.download(filePath);
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/web/index.html'));
});

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   Facebook Page Checker is running!                        ║
║                                                            ║
║   Open your browser and go to:                             ║
║   http://localhost:${PORT}                                      ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `);
});
