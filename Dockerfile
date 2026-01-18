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

WORKDIR /root/

# Install kubectl and dependencies
RUN apk add --no-cache curl ca-certificates \
    && curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" \
    && chmod +x kubectl \
    && mv kubectl /usr/local/bin/

# Copy binary
COPY --from=builder /app/centralizegg .

# Copy static files
COPY --from=builder /app/web_centralizegg/static ./web_centralizegg/static

# Expose port
EXPOSE 8080

# Run
CMD ["./centralizegg"]
