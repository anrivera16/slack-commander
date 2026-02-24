# Use Node.js LTS version as the base image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Create the workspace directory for volume mount
RUN mkdir -p /workspace

# Expose port (if needed for future HTTP endpoints)
EXPOSE 3000

# Start the application
CMD ["node", "index.js"]
