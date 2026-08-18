# AgnoHire — Technologies & Tools Documentation

This document serves as the comprehensive list of tools, libraries, and technologies used across the AgnoHire Enterprise AI Recruitment Management Platform.

## 🏗️ Architecture & Infrastructure
- **Monorepo Structure:** Managed via npm workspaces (`client`, `server`, `shared`) and `concurrently` for running dev servers.
- **Runtime:** Node.js (>= v20)
- **Containerization:** Docker & Docker Compose (for local PostgreSQL and Redis orchestration)
- **Language:** TypeScript v5.6 across the entire stack

---

## 💻 Frontend (`client` workspace)

### Core Framework
- **React 18:** Core UI library
- **Vite 6:** Ultra-fast frontend build tool and dev server
- **React Router DOM v6:** Client-side routing

### State Management & Data Fetching
- **Zustand:** Lightweight global state management
- **React Query (@tanstack/react-query):** Asynchronous state management, caching, and API data fetching

### Styling & UI
- **Tailwind CSS:** Utility-first CSS framework
- **Framer Motion:** Declarative animation library for React
- **Lucide React:** Icon library
- **Class Utilities:** `clsx`, `tailwind-merge`, and `class-variance-authority` for conditional and scalable class names
- **Typography:** @fontsource packages for *JetBrains Mono*, *Plus Jakarta Sans*, and *Syne*
- **Data Visualization:** Recharts for analytics and graphs

### Forms & Validation
- **React Hook Form:** Performant, flexible, and extensible forms
- **Zod:** TypeScript-first schema validation
- **@hookform/resolvers:** Zod integration for React Hook Form

### Client-Side Features & Utilities
- **Socket.io-client:** Real-time bi-directional communication
- **Axios:** HTTP client
- **Date-fns:** Modern JavaScript date utility library
- **TensorFlow.js (@tensorflow/tfjs & blazeface):** In-browser AI models (e.g., for proctoring/face detection)
- **SheetJS (xlsx):** Excel/CSV file parsing and exporting
- **React Hot Toast:** Toast notifications

---

## ⚙️ Backend (`server` workspace)

### Core Framework
- **Express.js:** Web framework for Node.js
- **Zod:** Used in `shared` and `server` for strict input validation

### Database & ORM
- **PostgreSQL:** Relational database
- **Prisma ORM (@prisma/client v5):** Next-generation Node.js and TypeScript ORM

### Caching, Rate Limiting & Background Jobs
- **Redis (ioredis):** In-memory data store for caching and queues
- **Bull:** Redis-based queue for handling heavy background jobs (e.g., AI analysis)
- **Bull Board (@bull-board/express):** UI dashboard to monitor Bull queues
- **Rate Limiting:** `express-rate-limit` combined with `rate-limit-redis` for distributed rate limiting

### Security & Authentication
- **Passport.js:** Authentication middleware
- **Passport-Google-OAuth20:** Google Single Sign-On (SSO) integration
- **JSON Web Tokens (jsonwebtoken):** Stateless authentication tokens
- **Bcrypt:** Password hashing
- **Helmet:** Secure Express apps by setting HTTP response headers
- **CORS:** Cross-Origin Resource Sharing middleware
- **Isomorphic DOMPurify:** Server-side HTML sanitization against XSS attacks

### File & Media Processing
- **Multer:** Middleware for handling `multipart/form-data` (file uploads)
- **PDF Parse / PDF.js:** Extracting text from PDF resumes
- **Mammoth:** Converting Word documents (.docx) to HTML/text
- **CSV-Parse:** Robust CSV parser
- **Tesseract.js:** Optical Character Recognition (OCR) for image-based resumes
- **FFmpeg (child_process execution):** Used for audio extraction and conversion (e.g., WebM to MP3) before Whisper transcription
- **@napi-rs/canvas:** Native canvas implementation for Node.js

### Real-time & Communication
- **Socket.io:** WebSockets for real-time notifications to users
- **Nodemailer:** Sending emails (e.g., candidate performance reports)

### Logging & Utilities
- **Winston / Morgan:** Advanced logging and HTTP request logging
- **Dotenv:** Environment variable management

---

## 🤖 Artificial Intelligence Services
- **OpenAI API:** General LLM processing for evaluation, reasoning, and summarization
- **OpenAI Whisper:** Speech-to-text models for transcribing interview recordings
- **TensorFlow.js (BlazeFace):** Client-side real-time video proctoring and face tracking
