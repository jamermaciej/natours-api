FROM node:12.22.0
RUN npm install --global nodemon
WORKDIR /app
COPY . /app
RUN npm install
EXPOSE 3000
CMD ["nodemon", "server.js"]