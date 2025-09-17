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


WORKDIR /app

COPY package*.json ./
# use install so lockfile mismatches don't break builds; for strict reproducibility use npm ci after fixing lockfile
RUN npm install --omit=dev

COPY . .

# copy entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# ENV for puppeteer to use system chrome
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]

