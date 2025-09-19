FROM node:18-slim

# Install Chromium dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    xdg-utils \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Workdir
WORKDIR /app

# Copy package.json & install deps
COPY package*.json ./
RUN npm install --omit=dev

# Copy app
COPY . .

# Expose port
EXPOSE 8080

# Run entrypoint
CMD ["./entrypoint.sh"]

