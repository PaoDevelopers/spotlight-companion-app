// Package awards decides prize winners from attendance, exhibit visits, votes and judge scores.
//
// It is a direct port of the TypeScript lib/awards/compute.ts, kept identical (including how ties
// are broken) so results match what was already reviewed. Everything here is a pure function.
package awards

import (
	"math"
	"sort"
	"time"
)

type Checkin struct {
	UserID, EventID int64
	At              time.Time
}
type Visit struct{ UserID, ExhibitID int64 }
type Vote struct{ VoterID, ExhibitID int64 }
type JudgeScore struct {
	ExhibitID int64
	Score     float64 // 0-100
}
type ExhibitOwner struct {
	ExhibitID int64
	UserIDs   []int64
}
type Weights struct{ Peer, Judge float64 }

type Input struct {
	Checkins        []Checkin
	Visits          []Visit
	TotalExhibits   int
	Votes           []Vote
	JudgeScores     []JudgeScore
	ExhibitOwners   []ExhibitOwner
	CreativeWeights *Weights // nil means 50/50
}

type Ranked struct {
	UserID  int64
	Rank    int
	Metrics map[string]float64
}

type Result struct {
	Participation []Ranked
	Explorer      []Ranked
	Creative      []Ranked
}

type row struct {
	userID int64
	score  float64
	tie    float64
}

// rankBy ranks by score descending; ties go to the smaller tie value, then the lower user id.
func rankBy(rows []row, limit int) []Ranked {
	kept := make([]row, 0, len(rows))
	for _, r := range rows {
		if r.score > 0 {
			kept = append(kept, r)
		}
	}
	sort.SliceStable(kept, func(i, j int) bool {
		a, b := kept[i], kept[j]
		if a.score != b.score {
			return a.score > b.score
		}
		if a.tie != b.tie {
			return a.tie < b.tie
		}
		return a.userID < b.userID
	})
	if len(kept) > limit {
		kept = kept[:limit]
	}
	out := make([]Ranked, len(kept))
	for i, r := range kept {
		out[i] = Ranked{UserID: r.userID, Rank: i + 1, Metrics: map[string]float64{"score": r.score}}
	}
	return out
}

// MostParticipation counts distinct events attended. Ties: whoever's last counted event came first.
func MostParticipation(in Input, limit int) []Ranked {
	type seen struct {
		order []int64
		at    map[int64]time.Time
	}
	per := map[int64]*seen{}
	var users []int64
	for _, c := range in.Checkins {
		s := per[c.UserID]
		if s == nil {
			s = &seen{at: map[int64]time.Time{}}
			per[c.UserID] = s
			users = append(users, c.UserID)
		}
		if _, ok := s.at[c.EventID]; !ok { // the first scan of an event is the one that counts
			s.at[c.EventID] = c.At
			s.order = append(s.order, c.EventID)
		}
	}
	rows := make([]row, 0, len(users))
	for _, u := range users {
		s := per[u]
		var latest int64 = math.MinInt64
		for _, t := range s.at {
			if ms := t.UnixMilli(); ms > latest {
				latest = ms
			}
		}
		rows = append(rows, row{userID: u, score: float64(len(s.at)), tie: float64(latest)})
	}
	return rankBy(rows, limit)
}

// Explorer counts distinct exhibits visited and notes whether the student saw them all.
func Explorer(in Input, limit int) []Ranked {
	per := map[int64]map[int64]bool{}
	var users []int64
	for _, v := range in.Visits {
		if per[v.UserID] == nil {
			per[v.UserID] = map[int64]bool{}
			users = append(users, v.UserID)
		}
		per[v.UserID][v.ExhibitID] = true
	}
	rows := make([]row, 0, len(users))
	for _, u := range users {
		rows = append(rows, row{userID: u, score: float64(len(per[u]))})
	}
	ranked := rankBy(rows, limit)
	for i := range ranked {
		done := 0.0
		if ranked[i].Metrics["score"] >= float64(in.TotalExhibits) && in.TotalExhibits > 0 {
			done = 1
		}
		ranked[i].Metrics["completedAll"] = done
	}
	return ranked
}

// jsRound rounds half up like JavaScript's Math.round.
func jsRound(x float64) float64 { return math.Floor(x + 0.5) }

// MostCreative blends peer-vote share and mean judge score (each 0-100) by weight.
// The prize goes to the exhibit's owners. As in the original, a student who owns several exhibits
// appears once per exhibit, with the peer/judge values of the last one listed.
func MostCreative(in Input, limit int) []Ranked {
	peer, judge := 0.5, 0.5
	if in.CreativeWeights != nil {
		peer, judge = in.CreativeWeights.Peer, in.CreativeWeights.Judge
	}
	total := peer + judge
	if total == 0 {
		total = 1
	}

	voteCount := map[int64]int{}
	maxVotes := 0
	for _, v := range in.Votes {
		voteCount[v.ExhibitID]++
		if voteCount[v.ExhibitID] > maxVotes {
			maxVotes = voteCount[v.ExhibitID]
		}
	}
	type sum struct {
		total float64
		n     int
	}
	judged := map[int64]*sum{}
	for _, j := range in.JudgeScores {
		s := judged[j.ExhibitID]
		if s == nil {
			s = &sum{}
			judged[j.ExhibitID] = s
		}
		s.total += j.Score
		s.n++
	}

	var rows []row
	peerPart, judgePart := map[int64]float64{}, map[int64]float64{}
	for _, o := range in.ExhibitOwners {
		p := 0.0
		if maxVotes > 0 {
			p = float64(voteCount[o.ExhibitID]) / float64(maxVotes) * 100
		}
		j := 0.0
		if s := judged[o.ExhibitID]; s != nil {
			j = s.total / float64(s.n)
		}
		combined := jsRound((p*peer+j*judge)/total*100) / 100
		for _, u := range o.UserIDs {
			rows = append(rows, row{userID: u, score: combined, tie: -j})
			peerPart[u], judgePart[u] = p, j
		}
	}
	ranked := rankBy(rows, limit)
	for i := range ranked {
		u := ranked[i].UserID
		ranked[i].Metrics["peer"] = peerPart[u]
		ranked[i].Metrics["judge"] = judgePart[u]
	}
	return ranked
}

// Compute runs every award. Each list holds at most three winners.
func Compute(in Input) Result {
	return Result{
		Participation: MostParticipation(in, 3),
		Explorer:      Explorer(in, 3),
		Creative:      MostCreative(in, 3),
	}
}
