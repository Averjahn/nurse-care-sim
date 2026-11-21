import { ArrowDown, Check, CircleAlert, Clock3, X } from 'lucide-react'
import { getCase, objectLabels } from './scenario'
import { actionById } from './scenario'
import type { Attempt } from './simulation'
import { actualSteps, formatDuration, passageTime, referenceDiagram } from './debrief'

export default function ResultsPanel({ attempt, onRepeat, onMenu }: { attempt: Attempt; onRepeat: () => void; onMenu: () => void }) {
  const actual = actualSteps(attempt), reference = referenceDiagram(attempt)
  const referenceCount = reference.reduce((sum, plan) => sum + plan.steps.length, 0)
  return <section className="results-panel glass-panel" aria-labelledby="results-title">
    <span className="eyebrow">РАЗБОР ПОПЫТКИ · {getCase(attempt.caseId).title}</span>
    <div className="results-heading"><h1 id="results-title">{attempt.phase === 'finished' ? 'Помощь передана' : 'Эпизод завершён'}</h1><div className="passage-time"><Clock3 size={20} aria-hidden="true"/><div><span>Время прохождения</span><strong>{passageTime(attempt)}</strong></div></div></div>
    <p>{attempt.outcome}</p>
    <div className="timeline-legend" aria-label="Обозначения шагов"><span className="correct"><Check size={14}/>Верный шаг</span><span className="warning"><CircleAlert size={14}/>Ошибка или нарушение приоритета</span><span className="critical"><X size={14}/>Критическая ошибка</span></div>
    <p className="comparison-note">Сравните действия шаг за шагом. Приоритетные шаги отмечены отдельно. Равноценные действия можно выполнять в разном порядке; эталон учитывает это при сравнении.</p>
    <div className="timeline-comparison">
      <section className="timeline-lane actual-lane" aria-labelledby="actual-title">
        <h2 id="actual-title">Ваши действия <span>{actual.length}</span></h2>
        <ol className="step-diagram">{actual.map((step, index) => <li key={index} className={`diagram-node ${step.tone}`} data-action={step.action}>
          <div className="step-meta"><span className="step-number">{index + 1}</span><time>{formatDuration(step.at)}</time></div>
          <strong className="step-title">{step.title}</strong>
          <span className="step-object">{objectLabels[actionById(step.action).target.object]}</span>
          <span className="step-status">{step.tone === 'correct' ? <><Check size={13}/>Выполнено</> : <><CircleAlert size={13}/>{step.severity === 'critical' ? 'Критическая ошибка' : step.severity === 'major' ? 'Существенная ошибка' : step.severity === 'minor' ? 'Незначительная ошибка' : 'Не выполнено'}{step.severity && !step.performed && !step.automatic ? ' · действие отклонено' : ''}</>}</span>
          {attempt.carePlans.length > 1 && <span className="step-context">{step.episode}</span>}
          {step.reasons.map((reason, i) => <p className="step-reason" key={i}>{reason}</p>)}
          {index < actual.length - 1 && <ArrowDown className="diagram-arrow" size={19} aria-hidden="true"/>}
        </li>)}</ol>
        {!actual.length && <p className="empty-timeline">Действия ещё не выполнялись.</p>}
      </section>
      <section className="timeline-lane reference-lane" aria-labelledby="reference-title">
        <h2 id="reference-title">Эталонная последовательность <span>{referenceCount}</span></h2>
        <ol className="step-diagram reference-diagram">{reference.flatMap((plan, planIndex) => [
          ...(plan.changed ? [<li className="branch-marker" key={`branch-${planIndex}`}>{plan.title}<small>Дополнительная ветвь при изменении состояния</small></li>] : []),
          ...plan.steps.map((step, stepIndex) => <li key={`${planIndex}-${stepIndex}`} className="diagram-node reference-node" data-action={step.id}>
            <div className="step-meta"><span className="step-number">{reference.slice(0, planIndex).reduce((sum, item) => sum + item.steps.length, 0) + stepIndex + 1}</span>{step.priority && <span className="priority-label">Приоритетный шаг</span>}</div>
            <strong className="step-title">{step.title}</strong>
            <span className="step-object">{objectLabels[actionById(step.id).target.object]}</span>
            {step.covered.length > 1 && <span className="step-object">Также: {step.covered.filter(title => title !== step.title).join('; ')}</span>}
            <span className={`reference-check ${step.status}`}>{step.status === 'done' ? <><Check size={13}/>Выполнено</> : step.status === 'late' ? <><Clock3 size={13}/>С опозданием</> : <><X size={13}/>Пропущено</>}</span>
            {(planIndex < reference.length - 1 || stepIndex < plan.steps.length - 1) && <ArrowDown className="diagram-arrow" size={19} aria-hidden="true"/>}
          </li>),
        ])}</ol>
      </section>
    </div>
    <div className="result-buttons"><button className="primary-button" onClick={onRepeat}>Повторить эпизод</button><button className="secondary-button" onClick={onMenu}>Выбрать другой</button></div>
  </section>
}
