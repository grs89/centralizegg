# Build Stage
FROM golang:1.23-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Build statically
RUN CGO_ENABLED=0 GOOS=linux go build -o centralize ./cmd/server

# Run Stage
FROM alpine:latest

WORKDIR /root/

# Copy binary
COPY --from=builder /app/centralize .

# Copy static files
COPY --from=builder /app/web/static ./web/static

# Expose port
EXPOSE 8080

# Run
CMD ["./centralize"]
