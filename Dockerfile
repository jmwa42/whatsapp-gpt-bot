# Use official Node image with Debian (so we can apt-get install packages)
FROM node:18-bullseye

# Install Chromium & dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libxrender1 \
    xdg-utils \
    chromium \
    --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*

# Work directory
WORKDIR /app

# Copy package files and install deps
COPY package*.json ./
RUN npm ci --only=production

# Copy app source
COPY . .

# Create session storage folder for WhatsApp auth
RUN mkdir -p /app/.wwebjs_auth && chown -R node:node /app/.wwebjs_auth

# Use non-root user for security
USER node

# Environment variables for puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Expose port if API is served
EXPOSE 3000

# Start the bot
CMD ["node", "index.js"]
