// src/views/team/hooks/useTeamDecisionSubmission.ts
// Updated to properly handle both immediate purchases and regular submissions

import {useState, useCallback, useMemo, useEffect} from 'react';
import {useSupabaseMutation, useSupabaseQuery} from '@shared/hooks/supabase';
import {db} from '@shared/services/supabase';
import {supabase} from '@shared/services/supabase';
import {Slide, GameStructure} from '@shared/types';
import {DecisionState} from './useDecisionMaking';

interface UseTeamDecisionSubmissionProps {
    sessionId: string | null;
    teamId: string | null;
    currentSlide: Slide | null;
    decisionState: DecisionState;
    isValidSubmission: boolean;
    gameStructure?: GameStructure;
}

export interface UseTeamDecisionSubmissionReturn {
    isSubmitting: boolean;
    isSubmitDisabled: boolean;
    submissionError: string | null;
    submissionSuccess: boolean;
    hasExistingSubmission: boolean;
    existingSubmissionSummary: string | null;
    onSubmit: () => Promise<void>;
}

// Define types that match the actual database schema
interface TeamDecisionRow {
    id: string;
    session_id: string;
    team_id: string;
    phase_id: string;
    round_number: number;
    selected_investment_ids: string[] | null;
    selected_challenge_option_id: string | null;
    double_down_sacrifice_id: string | null;
    double_down_on_id: string | null;
    total_spent_budget: number | null;
    submitted_at: string | null;
    is_immediate_purchase: boolean | null;
    immediate_purchase_type: string | null;
    immediate_purchase_data: any;
    report_given: boolean | null;
    report_given_at: string | null;
}

const formatCurrency = (value: number): string => {
    if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
};

export const useTeamDecisionSubmission = ({
                                              sessionId,
                                              teamId,
                                              currentSlide,
                                              decisionState,
                                              isValidSubmission,
                                              gameStructure
                                          }: UseTeamDecisionSubmissionProps): UseTeamDecisionSubmissionReturn => {
    const [submissionError, setSubmissionError] = useState<string | null>(null);
    const [submissionSuccess, setSubmissionSuccess] = useState(false);

    const decisionKey = currentSlide?.interactive_data_key;

    // Fetch regular submission - with more frequent refresh for resets
    const {
        data: existingDecision,
        isLoading: isCheckingExisting,
        refresh: checkForExistingDecision
    } = useSupabaseQuery(
        async () => {
            if (!sessionId || !teamId || !decisionKey) return null;

            console.log('Querying for regular decision:', {sessionId, teamId, decisionKey});

            try {
                const result = await db.decisions.getForPhase(sessionId, teamId, decisionKey);
                console.log('Regular decision query result:', result);
                return result;
            } catch (error) {
                console.error('Error querying regular decision:', error);
                return null;
            }
        },
        [sessionId, teamId, decisionKey],
        {cacheKey: `decision-${sessionId}-${teamId}-${decisionKey}`, cacheTimeout: 2000, retryOnError: false}
    );

    // Fetch immediate purchases for this phase - with more frequent refresh
    const {
        data: immediatePurchases = [],
        refresh: refreshImmediatePurchases
    } = useSupabaseQuery(
        async (): Promise<TeamDecisionRow[]> => {
            if (!sessionId || !teamId || !decisionKey) return [];

            const immediatePhaseId = `${decisionKey}_immediate`;

            try {
                const {data, error} = await supabase
                    .from('team_decisions')
                    .select('*')
                    .eq('session_id', sessionId)
                    .eq('team_id', teamId)
                    .eq('phase_id', immediatePhaseId)
                    .eq('is_immediate_purchase', true);

                if (error) {
                    console.log('No immediate purchases found:', error);
                    return [];
                }

                return (data || []) as TeamDecisionRow[];
            } catch (error) {
                console.log('Error fetching immediate purchases:', error);
                return [];
            }
        },
        [sessionId, teamId, decisionKey],
        {
            cacheKey: `immediate-purchases-${sessionId}-${teamId}-${decisionKey}`,
            cacheTimeout: 2000,
            retryOnError: false
        }
    );

    const hasExistingSubmission = useMemo(() => {
        // For investment slides, only consider it "submitted" if there's a regular submission
        // Immediate purchases alone should NOT prevent further submissions
        if (currentSlide?.type === 'interactive_invest') {
            const hasRegular = !!(existingDecision?.submitted_at);
            console.log('hasExistingSubmission check:', {
                hasRegular,
                existingDecision: !!existingDecision,
                result: hasRegular
            });
            return hasRegular;
        }

        // For other slide types, only check regular submission
        return !!(existingDecision?.submitted_at);
    }, [existingDecision, currentSlide?.type]);

    const existingSubmissionSummary = useMemo(() => {
        console.log('=== SAFE SUBMISSION SUMMARY ===');

        try {
            if (!currentSlide || !gameStructure) {
                console.log('Missing currentSlide or gameStructure');
                return null;
            }

            console.log('existingDecision exists:', !!existingDecision);
            console.log('immediatePurchases count:', immediatePurchases?.length || 0);

            if (currentSlide.type === 'interactive_invest') {
                // Only show summary if there's a regular submission
                if (existingDecision?.submitted_at) {
                    console.log('Found regular submission, building summary...');

                    const key = currentSlide.interactive_data_key!;
                    const allSelectedIds: string[] = [];
                    let totalSpent = 0;

                    // Add immediate purchases
                    if (immediatePurchases && immediatePurchases.length > 0) {
                        immediatePurchases.forEach((purchase: TeamDecisionRow) => {
                            if (purchase.selected_investment_ids) {
                                allSelectedIds.push(...purchase.selected_investment_ids);
                            }
                            totalSpent += purchase.total_spent_budget || 0;
                        });
                    }

                    // Add regular submission
                    if (existingDecision.selected_investment_ids) {
                        allSelectedIds.push(...existingDecision.selected_investment_ids);
                        totalSpent += existingDecision.total_spent_budget || 0;
                    }

                    if (allSelectedIds.length === 0) {
                        return "No investments selected";
                    }

                    // Format names
                    const investmentOptions = gameStructure.all_investment_options[key] || [];
                    const selectedNames = allSelectedIds.map(id => {
                        const option = investmentOptions.find(o => o.id === id);
                        return option ? option.name.split('.')[0] : 'Unknown';
                    }).join(', ');

                    return `${selectedNames} (${formatCurrency(totalSpent)} spent)`;
                }

                console.log('No regular submission found');
                return null;
            }

            // For other slide types
            if (existingDecision?.submitted_at) {
                const key = currentSlide.interactive_data_key!;
                const choiceOptions = gameStructure.all_challenge_options[key] || [];
                const choice = choiceOptions.find(o => o.id === existingDecision.selected_challenge_option_id);
                return choice ? `Selected: ${choice.text}` : 'Decision submitted';
            }

            return null;

        } catch (error) {
            console.error('Error in summary calculation:', error);
            return null;
        }
    }, [existingDecision, immediatePurchases, currentSlide, gameStructure]);

    useEffect(() => {
        if (currentSlide?.id) {
            setSubmissionSuccess(false);
            setSubmissionError(null);
            checkForExistingDecision();
            refreshImmediatePurchases();
        }
    }, [currentSlide?.id]);

    // Add real-time subscription for reset detection
    useEffect(() => {
        if (!sessionId || !teamId || !decisionKey) return;

        console.log('Team: Setting up real-time subscription for decision resets');

        const channel = supabase.channel(`team-decisions-${sessionId}-${teamId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'team_decisions',
                filter: `session_id=eq.${sessionId} AND team_id=eq.${teamId} AND phase_id=eq.${decisionKey}`
            }, (payload) => {
                console.log('Team: Decision change detected:', payload);

                // If decision was deleted (reset), refresh our data
                if (payload.eventType === 'DELETE') {
                    console.log('Team: Decision was reset, refreshing data');
                    setTimeout(() => {
                        checkForExistingDecision();
                        refreshImmediatePurchases();
                    }, 100);
                }
            })
            .subscribe();

        return () => {
            console.log('Team: Cleaning up real-time subscription');
            supabase.removeChannel(channel);
        };
    }, [sessionId, teamId, decisionKey]);

    // Force a refresh of the summary when data changes
    useEffect(() => {
        if (existingDecision || (immediatePurchases && immediatePurchases.length > 0)) {
            console.log('Data changed, summary should update:', {
                hasExistingDecision: !!existingDecision,
                hasImmediatePurchases: !!(immediatePurchases && immediatePurchases.length > 0),
                currentSummary: existingSubmissionSummary
            });
        }
    }, [existingDecision, immediatePurchases, existingSubmissionSummary]);

    const {execute: submitDecisionMutation, isLoading: isMutationLoading, error: mutationError} = useSupabaseMutation(
        (payload: any) => {
            if (!sessionId || !teamId || !currentSlide || !decisionKey) throw new Error('Missing submission data');

            // Only prevent submission if there's already a regular submission
            const hasRegularSubmission = !!(existingDecision?.submitted_at);
            if (hasRegularSubmission) {
                throw new Error('A decision has already been submitted.');
            }

            console.log('Submitting regular decision payload:', payload);

            const submissionPayload = {
                session_id: sessionId,
                team_id: teamId,
                phase_id: decisionKey,
                round_number: currentSlide.round_number,
                ...payload
            };

            console.log('Final submission payload:', submissionPayload);
            return db.decisions.upsert(submissionPayload);
        },
        {
            onSuccess: () => {
                console.log('Regular submission successful');
                setSubmissionError(null);
                setSubmissionSuccess(true);
                setTimeout(() => {
                    checkForExistingDecision();
                    refreshImmediatePurchases();
                }, 500);
            },
            onError: (error) => {
                console.error('Regular submission failed:', error);
                setSubmissionError(error instanceof Error ? error.message : 'Submission failed');
            },
        }
    );

    const isSubmitDisabled = isMutationLoading || isCheckingExisting || !isValidSubmission || !!(existingDecision?.submitted_at);

    const onSubmit = useCallback(async () => {
        if (isSubmitDisabled) return;

        setSubmissionError(null);
        try {
            const payload: any = {};
            switch (currentSlide?.type) {
                case 'interactive_invest':
                    payload.selected_investment_ids = decisionState.selectedInvestmentIds;
                    payload.total_spent_budget = decisionState.spentBudget;
                    break;
                case 'interactive_choice':
                case 'interactive_double_down_prompt':
                    payload.selected_challenge_option_id = decisionState.selectedChallengeOptionId;
                    break;
                default:
                    throw new Error("Cannot submit for this slide type.");
            }

            console.log('About to submit with payload:', payload);
            console.log('Decision state at submission:', decisionState);

            await submitDecisionMutation(payload);
        } catch (error) {
            console.error('Submission error:', error);
            setSubmissionError(error instanceof Error ? error.message : 'Failed to prepare submission.');
        }
    }, [isSubmitDisabled, currentSlide, decisionState, submitDecisionMutation]);

    return {
        isSubmitting: isMutationLoading,
        isSubmitDisabled,
        submissionError: submissionError || mutationError,
        submissionSuccess,
        hasExistingSubmission,
        existingSubmissionSummary,
        onSubmit
    };
};
