import { ChevronDown, MessageCircle, UserRound } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { DialogueOption } from './scenario'

export interface PatientChatMessage {
  id: number
  speaker: 'patient' | 'nurse'
  text: string
}

interface PatientChatProps {
  isOpen: boolean
  patientName: string
  stageTitle: string
  messages: PatientChatMessage[]
  options: DialogueOption[]
  onToggle: () => void
  onSelectOption: (option: DialogueOption) => void
}

function PatientChat({
  isOpen,
  patientName,
  stageTitle,
  messages,
  options,
  onToggle,
  onSelectOption,
}: PatientChatProps) {
  const messageListRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    const messageList = messageListRef.current
    if (messageList) messageList.scrollTop = messageList.scrollHeight
  }, [messages, isOpen])

  if (!isOpen) {
    return (
      <button className="patient-chat-launcher glass-panel" type="button" onClick={onToggle}>
        <MessageCircle size={17} />
        <span>Диалог с пациенткой</span>
      </button>
    )
  }

  return (
    <section className="patient-chat glass-panel" aria-label="Диалог с пациенткой">
      <header className="patient-chat-header">
        <span className="patient-chat-avatar"><UserRound size={19} /></span>
        <div className="patient-chat-heading">
          <strong>{patientName}</strong>
          <span>{stageTitle}</span>
        </div>
        <button
          className="patient-chat-minimize"
          type="button"
          aria-label="Свернуть диалог"
          onClick={onToggle}
        >
          <ChevronDown size={18} />
        </button>
      </header>

      <ol className="patient-chat-messages" ref={messageListRef} aria-live="polite">
        {messages.map((message) => (
          <li
            className={`patient-chat-message patient-chat-message-${message.speaker}`}
            key={message.id}
          >
            {message.speaker === 'patient' && (
              <span className="patient-chat-message-avatar"><UserRound size={14} /></span>
            )}
            <p>{message.text}</p>
            {message.speaker === 'nurse' && <span className="patient-chat-sender">Вы</span>}
          </li>
        ))}
      </ol>

      <footer className="patient-chat-replies">
        {options.length > 0 ? (
          <>
            <span className="patient-chat-prompt">Выберите ответ</span>
            {options.map((option) => (
              <button
                className="patient-chat-reply"
                key={option.text}
                type="button"
                onClick={() => onSelectOption(option)}
              >
                {option.text}
              </button>
            ))}
          </>
        ) : (
          <p className="patient-chat-acknowledgement">
            Ответ принят. Продолжайте текущий пункт чек-листа.
          </p>
        )}
      </footer>
    </section>
  )
}

export default PatientChat
