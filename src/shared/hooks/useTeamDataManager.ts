// src/shared/hooks/useTeamDataManager.ts
// FIXED VERSION - Updated resetTeamDecisionInDb to protect immediate purchases

import { useState, useEffect, useCallback, Dispatch, SetStateAction } from 'react';
import { db, formatSupabaseError, useRealtimeSubscription } from '@shared/services/supabase';
import { Team, TeamDecision, TeamRoundData } from '@shared/types';

interface TeamDataManagerOutput {
    teams: Team[];
    teamDecisions: Record<string, Record<string, TeamDecision>>;
    teamRoundData: Record<string, Record<number, TeamRoundData>>;
    isLoadingTeams: boolean;
    isLoadingDecisions: boolean;
    isLoadingRoundData: boolean;
    error: string | null;
    fetchTeamsForSession: (sessionId: string) => Promise<void>;
    fetchTeamDecisionsForSession: (sessionId: string) => Promise<void>;
    fetchTeamRoundDataForSession: (sessionId: string) => Promise<void>;
    resetTeamDecisionInDb: (sessionId: string, teamId: string, phaseId: string) => Promise<void>;
    setTeamRoundDataDirectly: Dispatch<SetStateAction<Record<string, Record<number, TeamRoundData>>>>;
}

export const useTeamDataManager = (initialSessionId: string | null): TeamDataManagerOutput => {
    const [teams, setTeams] = useState<Team[]>([]);
    const [teamDecisions, setTeamDecisions] = useState<Record<string, Record<string, TeamDecision>>>({});
    const [teamRoundData, setTeamRoundData] = useState<Record<string, Record<number, TeamRoundData>>>({});
    const [isLoadingTeams, setIsLoadingTeams] = useState<boolean>(false);
    const [isLoadingDecisions, setIsLoadingDecisions] = useState<boolean>(false);
    const [isLoadingRoundData, setIsLoadingRoundData] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const fetchTeamsForSession = useCallback(async (sessionId: string) => {
        if (!sessionId || sessionId === 'new') {
            setTeams([]);
            return;
        }

        console.log("useTeamDataManager: Fetching teams for session:", sessionId);
        setIsLoadingTeams(true);
        setError(null);

        try {
            const data = await db.teams.getBySession(sessionId);
            setTeams(data as Team[]);
        } catch (err) {
            console.error("useTeamDataManager: Error fetching teams:", err);
            setError(`Failed to load teams: ${formatSupabaseError(err)}`);
            setTeams([]);
        } finally {
            setIsLoadingTeams(false);
        }
    }, []);

    const fetchTeamDecisionsForSession = useCallback(async (sessionId: string) => {
        if (!sessionId || sessionId === 'new') {
            setTeamDecisions({});
            return;
        }

        console.log("useTeamDataManager: Fetching team decisions for session:", sessionId);
        setIsLoadingDecisions(true);
        setError(null);

        try {
            const data = await db.decisions.getBySession(sessionId);

            const structuredDecisions: Record<string, Record<string, TeamDecision>> = {};
            (data || []).forEach(decision => {
                if (!structuredDecisions[decision.team_id]) {
                    structuredDecisions[decision.team_id] = {};
                }
                structuredDecisions[decision.team_id][decision.phase_id] = decision as TeamDecision;
            });
            setTeamDecisions(structuredDecisions);
        } catch (err) {
            console.error("useTeamDataManager: Error fetching team decisions:", err);
            setError(`Failed to load team decisions: ${formatSupabaseError(err)}`);
            setTeamDecisions({});
        } finally {
            setIsLoadingDecisions(false);
        }
    }, []);

    const fetchTeamRoundDataForSession = useCallback(async (sessionId: string) => {
        if (!sessionId || sessionId === 'new') {
            setTeamRoundData({});
            return;
        }

        console.log("useTeamDataManager: Fetching team round data for session:", sessionId);
        setIsLoadingRoundData(true);
        setError(null);

        try {
            const data = await db.kpis.getBySession(sessionId);

            const structuredRoundData: Record<string, Record<number, TeamRoundData>> = {};
            (data || []).forEach(rd => {
                if (!structuredRoundData[rd.team_id]) {
                    structuredRoundData[rd.team_id] = {};
                }
                structuredRoundData[rd.team_id][rd.round_number] = rd as TeamRoundData;
            });
            setTeamRoundData(structuredRoundData);
        } catch (err) {
            console.error("useTeamDataManager: Error fetching team round data:", err);
            setError(`Failed to load team KPI data: ${formatSupabaseError(err)}`);
            setTeamRoundData({});
        } finally {
            setIsLoadingRoundData(false);
        }
    }, []);

    // FIXED: Updated to protect immediate purchases from being reset
    const resetTeamDecisionInDb = useCallback(async (sessionId: string, teamId: string, phaseId: string) => {
        console.log(`[useTeamDataManager] resetTeamDecisionInDb called with:`, {
            sessionId: sessionId || 'MISSING',
            teamId: teamId || 'MISSING',
            phaseId: phaseId || 'MISSING'
        });

        if (!sessionId || !teamId || !phaseId) {
            const errorMsg = `Missing required IDs for reset: sessionId=${!!sessionId}, teamId=${!!teamId}, phaseId=${!!phaseId}`;
            console.error("[useTeamDataManager]", errorMsg);
            throw new Error("Missing session, team, or phase ID for reset.");
        }

        console.log(`useTeamDataManager: Resetting decision in DB for session ${sessionId}, team ${teamId}, phase ${phaseId}`);

        try {
            // This will now use the FIXED delete function that protects immediate purchases
            await db.decisions.delete(sessionId, teamId, phaseId);

            console.log(`useTeamDataManager: Successfully deleted regular decisions from DB, updating local state`);

            setTeamDecisions(prev => {
                const updated = JSON.parse(JSON.stringify(prev)); // Deep clone
                if (updated[teamId] && updated[teamId][phaseId]) {
                    delete updated[teamId][phaseId];
                    // If this was the last decision for this team, remove the team entry entirely
                    if (Object.keys(updated[teamId]).length === 0) {
                        delete updated[teamId];
                    }
                    console.log(`useTeamDataManager: Updated local state after reset - removed ${teamId}/${phaseId} (preserved immediate purchases)`);
                }
                return updated;
            });

            // ADDED: Force refresh team decisions to get fresh data from database
            await fetchTeamDecisionsForSession(sessionId);

        } catch (err) {
            console.error("useTeamDataManager: Error resetting team decision:", err);
            throw new Error(`Failed to reset decision: ${formatSupabaseError(err)}`);
        }
    }, [fetchTeamDecisionsForSession]);

    // Initial fetch when sessionId becomes available
    useEffect(() => {
        if (initialSessionId && initialSessionId !== 'new') {
            fetchTeamsForSession(initialSessionId);
            fetchTeamDecisionsForSession(initialSessionId);
            fetchTeamRoundDataForSession(initialSessionId);
        } else {
            setTeams([]);
            setTeamDecisions({});
            setTeamRoundData({});
        }
    }, [initialSessionId, fetchTeamsForSession, fetchTeamDecisionsForSession, fetchTeamRoundDataForSession]);

    // Conditional subscription based on parameter
    useRealtimeSubscription(
        `team-decisions-${initialSessionId}`,
        {
            table: 'team_decisions',
            filter: `session_id=eq.${initialSessionId}`,
            onchange: (payload) => {
                console.log('useTeamDataManager: Team decision change received:', payload.eventType);

                if (initialSessionId) {
                    fetchTeamDecisionsForSession(initialSessionId);
                }
            }
        },
        // Only enable if both conditions are true
        !!initialSessionId && initialSessionId !== 'new'
    );

    // Real-time subscription for team KPI updates
    useRealtimeSubscription(
        `team-kpis-${initialSessionId}`,
        {
            table: 'team_round_data',
            filter: `session_id=eq.${initialSessionId}`,
            onchange: (payload) => {
                console.log('useTeamDataManager: Team KPI change received:', payload.eventType, payload.new);
                const newKpiData = payload.new as TeamRoundData;
                const oldKpiData = payload.old as TeamRoundData;

                setTeamRoundData(prev => {
                    const updated = JSON.parse(JSON.stringify(prev));
                    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                        if (!updated[newKpiData.team_id]) updated[newKpiData.team_id] = {};
                        updated[newKpiData.team_id][newKpiData.round_number] = newKpiData;
                        console.log(`useTeamDataManager: Updated KPIs for team ${newKpiData.team_id}, round ${newKpiData.round_number}`);
                    } else if (payload.eventType === 'DELETE' && oldKpiData?.team_id && oldKpiData?.round_number) {
                        if (updated[oldKpiData.team_id]) {
                            delete updated[oldKpiData.team_id][oldKpiData.round_number];
                            if (Object.keys(updated[oldKpiData.team_id]).length === 0) delete updated[oldKpiData.team_id];
                        }
                    }
                    return updated;
                });
            }
        },
        !!initialSessionId && initialSessionId !== 'new'
    );

    return {
        teams, teamDecisions, teamRoundData,
        isLoadingTeams, isLoadingDecisions, isLoadingRoundData,
        error,
        fetchTeamsForSession, fetchTeamDecisionsForSession, fetchTeamRoundDataForSession,
        resetTeamDecisionInDb,
        setTeamRoundDataDirectly: setTeamRoundData
    };
};
