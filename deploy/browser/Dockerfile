FROM mcr.microsoft.com/playwright:v1.64.1-noble

RUN npm install --global playwright@1.64.1 \
    && npm cache clean --force

ENV HOME=/tmp
USER pwuser
ENTRYPOINT ["playwright"]
CMD ["run-server", "--port", "3000", "--host", "0.0.0.0", "--path", "/", "--max-clients", "4"]
