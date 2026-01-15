# Jiffy Junk Volume Assistant

A professional web application for estimating junk removal volume from photos using AI-powered computer vision (GPT-4 Vision).

## Features

- 📸 Upload multiple photos of debris for volume estimation
- ✏️ Mark photos with green (include) and red (exclude) annotations
- 🤖 AI-powered estimation in cubic yards with confidence levels
- 📊 History tracking with PostgreSQL database
- 🔒 PIN-based authentication
- 📱 Mobile-responsive design
- 🎨 Branded with Jiffy Junk colors and logo

## Testing Locally

### Prerequisites

- Node.js v18 or higher
- PostgreSQL database (local or cloud)
- OpenAI API key

### Setup Instructions

1. **Install dependencies:**
```bash
npm install
```

2. **Create a `.env` file:**
```bash
cp .env.example .env
```

3. **Edit `.env` with your values:**
```env
# Your OpenAI API Key
OPENAI_API_KEY=sk-your-api-key-here

# Database connection (local example)
DATABASE_URL=postgresql://user:password@localhost:5432/jiffy_volume_app

# Session secret (generate a random string)
SESSION_SECRET=your-random-secret-at-least-32-characters-long

# PIN for app access
APP_PIN=1234

# Port (optional)
PORT=3000
```

4. **Set up the database:**
```bash
# Create the database
createdb jiffy_volume_app

# Run the schema
psql jiffy_volume_app < schema.sql
```

5. **Start the development server:**
```bash
npm run dev
```

6. **Open your browser:**
```
http://localhost:3000
```

7. **Log in with your PIN** (default: 1234)

8. **Upload photos and test!**

## Deploying to Cloud

### Option 1: Railway.app (Recommended)

Railway is modern, easy to use, and has a generous free tier.

1. **Sign up at** [railway.app](https://railway.app)

2. **Install Railway CLI:**
```bash
npm i -g @railway/cli
railway login
```

3. **Initialize project:**
```bash
railway init
```

4. **Add PostgreSQL:**
```bash
railway add
# Select PostgreSQL from the list
```

5. **Set environment variables:**
```bash
railway variables set OPENAI_API_KEY="sk-your-key-here"
railway variables set APP_PIN="your-pin-here"
railway variables set SESSION_SECRET="your-random-secret-here"
railway variables set COOKIE_SECURE="true"
```

6. **Deploy:**
```bash
railway up
```

7. **Run database migrations:**
```bash
railway run psql $DATABASE_URL < schema.sql
```

8. **Open your app:**
```bash
railway open
```

### Option 2: Render.com

1. **Create account** at [render.com](https://render.com)

2. **Create PostgreSQL database:**
   - Click "New +" → "PostgreSQL"
   - Name it (e.g., "jiffy-volume-db")
   - Copy the "Internal Database URL"

3. **Connect and run schema:**
```bash
psql [your-internal-database-url] < schema.sql
```

4. **Create Web Service:**
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Settings:
     - **Name:** jiffy-volume-app
     - **Build Command:** `npm install`
     - **Start Command:** `npm start`

5. **Add Environment Variables:**
   - `OPENAI_API_KEY` = your OpenAI API key
   - `APP_PIN` = your PIN (e.g., 1234)
   - `SESSION_SECRET` = random string (32+ characters)
   - `DATABASE_URL` = your Internal Database URL
   - `DATABASE_SSL` = true
   - `COOKIE_SECURE` = true

6. **Deploy:**
   - Render will automatically deploy
   - Your app will be at: https://jiffy-volume-app.onrender.com

### Option 3: Heroku

1. **Install Heroku CLI:**
```bash
npm install -g heroku
heroku login
```

2. **Create app:**
```bash
heroku create jiffy-volume-app
heroku addons:create heroku-postgresql:essential-0
```

3. **Set environment variables:**
```bash
heroku config:set OPENAI_API_KEY="sk-your-key-here"
heroku config:set APP_PIN="your-pin-here"
heroku config:set SESSION_SECRET="your-random-secret-here"
heroku config:set COOKIE_SECURE="true"
```

4. **Deploy:**
```bash
git push heroku main
```

5. **Run migrations:**
```bash
heroku run "psql \$DATABASE_URL < schema.sql"
```

6. **Open app:**
```bash
heroku open
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | Your OpenAI API key for GPT-4 Vision |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `APP_PIN` | Yes | PIN code for accessing the app |
| `SESSION_SECRET` | Yes | Random secret for session encryption (32+ chars) |
| `PORT` | No | Server port (default: 3000) |
| `MODEL_NAME` | No | OpenAI model (default: "gpt-5") |
| `COOKIE_SECURE` | No | Set to "true" for HTTPS in production |
| `DATABASE_SSL` | No | Set to "true" for managed PostgreSQL with SSL |

## Usage

1. **Log in** with your PIN
2. **Select job type:**
   - Standard Junk Removal
   - Dumpster Cleanout
   - Dumpster Overflow / Arms-length
3. **Upload photos** of the debris
4. **Mark areas (optional):**
   - Green = Include in estimate
   - Red = Exclude from estimate
5. **Add notes** if needed
6. **Click "Estimate volume"**
7. **Review results** with cubic yard estimate and confidence level
8. **Copy** the result to clipboard

## AI Estimation Features

The AI uses advanced computer vision techniques:

- **Reference scaling** using doors, fences, dumpsters, curbs
- **Packing factor calculations** for different debris types
- **Special handling** for bagged debris, scattered piles
- **Multi-photo analysis** without double-counting
- **Overlay support** for precise inclusion/exclusion marking

## Architecture

- **Frontend:** Vanilla JavaScript with HTML5 Canvas for photo markup
- **Backend:** Node.js with Express
- **Database:** PostgreSQL for estimate history
- **AI:** OpenAI GPT-4 Vision API
- **Session:** Express-session with secure cookies
- **File Upload:** Multer with 15MB limit per image

## Security

- PIN-based authentication
- Session-based access control
- HTTP-only cookies
- Input validation and sanitization
- SQL injection protection via parameterized queries

## Support

For issues or questions, please open an issue on GitHub.

## License

Proprietary - Jiffy Junk
