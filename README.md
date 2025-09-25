# Creative Workbench

An AI-powered creative content generation tool that helps you create scripts and generate images for your creative projects.

## Prerequisites

Before running this application, you'll need to set up the following services:

### 1. Supabase Setup
1. Create a free account at [Supabase](https://supabase.com)
2. Create a new project
3. Go to your project settings and find your API credentials
4. Copy your project URL and anon key

### 2. API Keys Setup
- **Gemini API**: Get your API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
- **Doubao API**: Get your API key from [云武AI](https://yunwu.ai)

## Setup Instructions

## Getting Started

### 1. Configure Environment Variables

1. Copy the `.env.local` file and update it with your actual credentials:
```bash
cp .env.local .env.local
```

2. Edit `.env.local` and replace the placeholder values:
```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-actual-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-actual-anon-key

# API Keys
GEMINI_API_KEY=your-actual-gemini-api-key
DOUBAO_API_KEY=your-actual-doubao-api-key
```

### 2. Set up Supabase Database

1. Go to your Supabase project SQL editor
2. Copy the contents of `supabase_schema.sql`
3. Run the SQL script to create the required tables

### 3. Install Dependencies and Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
