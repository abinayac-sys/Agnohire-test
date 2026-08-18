import React from 'react';
import { X, ChevronLeft, ChevronRight, HelpCircle } from 'lucide-react';
import { Button } from './Button.js';

export interface WizardStep {
  title: string;
  description?: string;
  content: React.ReactNode;
  isNextDisabled?: boolean;
  onNext?: () => Promise<boolean> | boolean; // If returns false, don't proceed
  helpPanel?: React.ReactNode;
}

export interface WizardProps {
  title?: string;
  steps: WizardStep[];
  currentStep: number;
  onStepChange: (step: number) => void;
  onCancel: () => void;
  onComplete: () => void;
  isSubmitting?: boolean;
  hideStepsProgress?: boolean;
  completeButtonText?: string;
}

export function Wizard({ title, steps, currentStep, onStepChange, onCancel, onComplete, isSubmitting, hideStepsProgress, completeButtonText }: WizardProps) {
  const step = steps[currentStep];
  const isFirst = currentStep === 0;
  const isLast = currentStep === steps.length - 1;
  const [showHelp, setShowHelp] = React.useState(false);

  const handleNext = async () => {
    if (step.onNext) {
      const canProceed = await step.onNext();
      if (!canProceed) return;
    }
    if (isLast) {
      onComplete();
    } else {
      onStepChange(currentStep + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirst) onStepChange(currentStep - 1);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface sm:bg-black/50 sm:p-6 sm:justify-center sm:items-center">
      <div className="flex h-full w-full flex-col bg-surface shadow-2xl sm:h-auto sm:max-h-[90vh] sm:w-[900px] sm:rounded-2xl sm:overflow-hidden relative">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-4 sm:px-6 shrink-0 bg-surface z-20">
          <div>
            <h2 className="font-heading text-lg font-semibold text-text-primary">{title || 'Setup Wizard'}</h2>
            {!hideStepsProgress && (
              <p className="text-sm text-text-muted">Step {currentStep + 1} of {steps.length}</p>
            )}
          </div>
          <button onClick={onCancel} className="rounded-full p-2 text-text-muted hover:bg-hover hover:text-text-primary transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Progress Bar */}
        {!hideStepsProgress && (
          <div className="h-1 w-full bg-border shrink-0 z-20">
            <div 
              className="h-full bg-accent transition-all duration-300 ease-out" 
              style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }} 
            />
          </div>
        )}

        {/* Body Layout */}
        <div className="flex flex-1 overflow-hidden relative">
          {/* Main Content */}
          <div className="flex-1 overflow-y-auto p-6 sm:p-8 flex flex-col">
            <div className="max-w-xl mx-auto w-full">
              <div className="mb-8">
                <h3 className="font-heading text-2xl font-bold text-text-primary mb-2">{step.title}</h3>
                {step.description && <p className="text-text-secondary whitespace-pre-wrap">{step.description}</p>}
              </div>
              <div className="mb-6">
                {step.content}
              </div>
            </div>
          </div>

          {/* Help Panel Toggle (Mobile) */}
          {step.helpPanel && (
            <div className="absolute right-4 top-4 lg:hidden">
              <Button variant="ghost" size="sm" onClick={() => setShowHelp(!showHelp)}>
                <HelpCircle className="h-4 w-4 mr-2" /> Need Help?
              </Button>
            </div>
          )}

          {/* Help Panel (Desktop / Expandable) */}
          {step.helpPanel && (
            <div className={`
              absolute right-0 top-0 h-full w-full max-w-sm bg-surface-alt border-l border-border transition-transform duration-300 z-10
              lg:relative lg:transform-none lg:w-80 lg:max-w-none flex flex-col
              ${showHelp ? 'translate-x-0' : 'translate-x-full'}
            `}>
              <div className="p-4 border-b border-border flex justify-between items-center bg-surface lg:bg-transparent">
                <div className="flex items-center gap-2 font-medium text-text-primary">
                  <HelpCircle className="h-4 w-4 text-accent" /> Need Help?
                </div>
                <button className="lg:hidden p-1 text-text-muted" onClick={() => setShowHelp(false)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-5 overflow-y-auto flex-1 text-sm text-text-secondary space-y-4">
                {step.helpPanel}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="border-t border-border p-4 sm:px-6 flex items-center justify-between bg-surface shrink-0 z-20">
          <Button variant="ghost" onClick={onCancel} disabled={isSubmitting}>Cancel</Button>
          <div className="flex items-center gap-3">
            {!isFirst && (
              <Button variant="outline" onClick={handlePrev} disabled={isSubmitting}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Previous
              </Button>
            )}
            <Button 
              onClick={handleNext} 
              disabled={step.isNextDisabled || isSubmitting}
              loading={isSubmitting}
            >
              {isLast ? (completeButtonText || 'Finish Setup') : 'Next'} {!isLast && <ChevronRight className="h-4 w-4 ml-1" />}
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}
