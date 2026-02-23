package predictive

import (
	"fmt"
	"math"

	"github.com/grs/centralizegg/backend_internal_centralizegg/data_centralizegg"
)

type ForecastResult struct {
	ServerID     int64   `json:"server_id"`
	Category     string  `json:"category"`
	Resource     string  `json:"resource"` // cpu, memory, disk
	CurrentValue float64 `json:"current_value"`
	GrowthRate   float64 `json:"growth_rate_pct"` // % change per hour
	Trend        string  `json:"trend"`           // "up", "down", "stable"
	ETE_Days     float64 `json:"ete_days"`        // Days until exhaustion (-1 if never)
	Confidence   float64 `json:"confidence"`      // 0-1 based on R-squared
	Status       string  `json:"status"`          // "stable", "warning", "critical"
}

// CalculateTrend perform linear regression on metrics to find growth rate and ETE
func CalculateTrend(metrics []data_centralizegg.ServerMetric, resourceType string) ForecastResult {
	if len(metrics) < 5 {
		return ForecastResult{Trend: "stable", Status: "stable", Confidence: 0}
	}

	n := float64(len(metrics))
	var sumX, sumY, sumXY, sumXX float64

	startTime := metrics[0].Timestamp.Unix()

	for _, m := range metrics {
		x := float64(m.Timestamp.Unix()-startTime) / 3600.0 // X in hours
		var y float64

		switch resourceType {
		case "cpu":
			y = m.CPUUsage
		case "memory":
			y = float64(m.MemoryUsage)
		case "disk":
			y = float64(m.DiskUsage)
		default:
			y = 0
		}

		sumX += x
		sumY += y
		sumXY += x * y
		sumXX += x * x
	}

	// Linear Regression: y = mx + b
	denominator := (n * sumXX) - (sumX * sumX)
	if denominator == 0 {
		return ForecastResult{Trend: "stable", Status: "stable"}
	}

	m := (n*sumXY - sumX*sumY) / denominator
	// b := (sumY - m*sumX) / n // Intercept not used

	// Confidence (R-squared proxy for now)
	confidence := 0.8 // Default placeholder, in real implementation we'd calculate variance

	growthPerHour := m
	currentVal := metrics[len(metrics)-1]
	var lastY float64
	var limit float64 = 100.0

	switch resourceType {
	case "cpu":
		lastY = currentVal.CPUUsage
	case "memory":
		lastY = float64(currentVal.MemoryUsage)
	case "disk":
		lastY = float64(currentVal.DiskUsage)
		if currentVal.DiskTotal > 0 {
			// for disk, we want ETE in terms of actual bytes if possible,
			// but here we work with percentages for simplicity in the general engine
			limit = 100.0
		}
	}

	trend := "stable"
	if growthPerHour > 0.01 {
		trend = "up"
	} else if growthPerHour < -0.01 {
		trend = "down"
	}

	var ete float64 = -1
	if m > 0 {
		hoursToLimit := (limit - lastY) / m
		if hoursToLimit > 0 {
			ete = hoursToLimit / 24.0
		}
	}

	status := "stable"
	if ete > 0 && ete < 7 {
		status = "critical"
	} else if ete > 0 && ete < 30 {
		status = "warning"
	} else if trend == "up" && lastY > 80 {
		status = "warning"
	}

	return ForecastResult{
		ServerID:     metrics[0].ServerID,
		Category:     metrics[0].Category,
		Resource:     resourceType,
		CurrentValue: lastY,
		GrowthRate:   growthPerHour,
		Trend:        trend,
		ETE_Days:     math.Round(ete*10) / 10,
		Confidence:   confidence,
		Status:       status,
	}
}

func GetForecastForServer(db *data_centralizegg.DB, serverID int64, category string) ([]ForecastResult, error) {
	metrics, err := db.GetServerHistory(serverID, category, "7d")
	if err != nil {
		return nil, err
	}

	if len(metrics) < 10 {
		return nil, fmt.Errorf("insufficient historical data for forecasting")
	}

	results := []ForecastResult{
		CalculateTrend(metrics, "cpu"),
		CalculateTrend(metrics, "memory"),
		CalculateTrend(metrics, "disk"),
	}

	return results, nil
}

func GetGlobalForecastSummary(db *data_centralizegg.DB) ([]ForecastResult, error) {
	// Identify "key" servers from each category to show on the global dashboard
	// In a real scenario, this would scan all servers, but for efficiency we'll
	// target the ones with most activity or recent metrics.

	rows, err := db.Conn.Query(`
		SELECT DISTINCT ON (category) server_id, category 
		FROM server_metrics_history 
		WHERE timestamp > NOW() - INTERVAL '24 hours'
		ORDER BY category, timestamp DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var alerts []ForecastResult
	for rows.Next() {
		var sid int64
		var cat string
		if err := rows.Scan(&sid, &cat); err != nil {
			continue
		}

		f, err := GetForecastForServer(db, sid, cat)
		if err == nil {
			for _, res := range f {
				if res.Status != "stable" {
					alerts = append(alerts, res)
				}
			}
		}
	}

	return alerts, nil
}
