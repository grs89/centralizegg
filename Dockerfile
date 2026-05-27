# Build Stage
FROM golang:1.23-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Build statically
RUN CGO_ENABLED=0 GOOS=linux go build -o centralizegg ./cmd_centralizegg/server

# Run Stage
FROM alpine:latest

# Install kubectl and dependencies
RUN apk add --no-cache curl ca-certificates \
    && ARCH=$(uname -m) \
    && if [ "$ARCH" = "x86_64" ]; then K8S_ARCH="amd64"; elif [ "$ARCH" = "aarch64" ]; then K8S_ARCH="arm64"; else K8S_ARCH="amd64"; fi \
    && curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/${K8S_ARCH}/kubectl" \
    && chmod +x kubectl \
    && mv kubectl /usr/local/bin/

# Create appgroup and appuser (UID/GID 1001 for non-root execution)
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -h /home/appuser -s /bin/sh -D appuser

# Set up working directory
WORKDIR /app

# Set up SSH key directory owned by appuser for backend collection compatibility
RUN mkdir -p /root/.ssh && chown -R appuser:appgroup /root/.ssh && chmod 700 /root/.ssh

# Copy binary with correct ownership
COPY --from=builder --chown=appuser:appgroup /app/centralizegg .

# Copy static files with correct ownership
COPY --from=builder --chown=appuser:appgroup /app/web_centralizegg/static ./web_centralizegg/static

# Expose port
EXPOSE 8080

# Switch to non-root user
USER appuser

# Run
CMD ["./centralizegg"]
