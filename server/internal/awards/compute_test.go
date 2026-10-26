package awards

import (
	"encoding/json"
	"math"
	"os"
	"testing"
	"time"
)

// The vectors are produced by scripts/gen-vectors.mts from the original TypeScript implementation.
type vecInput struct {
	Checkins []struct {
		UserID  int64  `json:"userId"`
		EventID int64  `json:"eventId"`
		At      string `json:"at"`
	} `json:"checkins"`
	Visits []struct {
		UserID    int64 `json:"userId"`
		ExhibitID int64 `json:"exhibitId"`
	} `json:"visits"`
	TotalExhibits int `json:"totalExhibits"`
	Votes         []struct {
		VoterID   int64 `json:"voterId"`
		ExhibitID int64 `json:"exhibitId"`
	} `json:"votes"`
	JudgeScores []struct {
		ExhibitID int64   `json:"exhibitId"`
		Score     float64 `json:"score"`
	} `json:"judgeScores"`
	ExhibitOwners []struct {
		ExhibitID int64   `json:"exhibitId"`
		UserIDs   []int64 `json:"userIds"`
	} `json:"exhibitOwners"`
	CreativeWeights *struct{ Peer, Judge float64 } `json:"creativeWeights"`
}

type vecRanked struct {
	UserID  int64              `json:"userId"`
	Rank    int                `json:"rank"`
	Metrics map[string]float64 `json:"metrics"`
}

type scenario struct {
	Name  string   `json:"name"`
	Input vecInput `json:"input"`
	Want  struct {
		Participation []vecRanked `json:"participation"`
		Explorer      []vecRanked `json:"explorer"`
		Creative      []vecRanked `json:"creative"`
	} `json:"want"`
}

func (v vecInput) toInput(t *testing.T) Input {
	in := Input{TotalExhibits: v.TotalExhibits}
	for _, c := range v.Checkins {
		at, err := time.Parse(time.RFC3339Nano, c.At)
		if err != nil {
			t.Fatal(err)
		}
		in.Checkins = append(in.Checkins, Checkin{c.UserID, c.EventID, at})
	}
	for _, x := range v.Visits {
		in.Visits = append(in.Visits, Visit{x.UserID, x.ExhibitID})
	}
	for _, x := range v.Votes {
		in.Votes = append(in.Votes, Vote{x.VoterID, x.ExhibitID})
	}
	for _, x := range v.JudgeScores {
		in.JudgeScores = append(in.JudgeScores, JudgeScore{x.ExhibitID, x.Score})
	}
	for _, x := range v.ExhibitOwners {
		in.ExhibitOwners = append(in.ExhibitOwners, ExhibitOwner{x.ExhibitID, x.UserIDs})
	}
	if v.CreativeWeights != nil {
		in.CreativeWeights = &Weights{v.CreativeWeights.Peer, v.CreativeWeights.Judge}
	}
	return in
}

func sameRanking(t *testing.T, name string, got []Ranked, want []vecRanked) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("%s: got %d winners, want %d (%+v vs %+v)", name, len(got), len(want), got, want)
	}
	for i := range want {
		g, w := got[i], want[i]
		if g.UserID != w.UserID || g.Rank != w.Rank {
			t.Fatalf("%s[%d]: got user %d rank %d, want user %d rank %d", name, i, g.UserID, g.Rank, w.UserID, w.Rank)
		}
		if len(g.Metrics) != len(w.Metrics) {
			t.Fatalf("%s[%d]: metrics %v, want %v", name, i, g.Metrics, w.Metrics)
		}
		for k, wv := range w.Metrics {
			if gv, ok := g.Metrics[k]; !ok || math.Abs(gv-wv) > 1e-9 {
				t.Fatalf("%s[%d]: metric %q = %v, want %v", name, i, k, g.Metrics[k], wv)
			}
		}
	}
}

func TestMatchesTypeScriptImplementation(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/awards_vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var scenarios []scenario
	if err := json.Unmarshal(raw, &scenarios); err != nil {
		t.Fatal(err)
	}
	if len(scenarios) < 60 {
		t.Fatalf("expected the full vector set, found %d scenarios", len(scenarios))
	}
	for _, s := range scenarios {
		t.Run(s.Name, func(t *testing.T) {
			got := Compute(s.Input.toInput(t))
			sameRanking(t, "participation", got.Participation, s.Want.Participation)
			sameRanking(t, "explorer", got.Explorer, s.Want.Explorer)
			sameRanking(t, "creative", got.Creative, s.Want.Creative)
		})
	}
}
