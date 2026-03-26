from datetime import datetime
from sqlalchemy import String, Float, Integer, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


class Speaker(Base):
    __tablename__ = "speakers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    voices: Mapped[list["SpeakerVoice"]] = relationship("SpeakerVoice", back_populates="speaker", cascade="all, delete-orphan")
    transcripts: Mapped[list["Transcript"]] = relationship("Transcript", back_populates="speaker")


class SpeakerVoice(Base):
    __tablename__ = "speaker_voices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    speaker_id: Mapped[int] = mapped_column(ForeignKey("speakers.id"), nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False)
    embedding_path: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    speaker: Mapped["Speaker"] = relationship("Speaker", back_populates="voices")


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    language: Mapped[str] = mapped_column(String, default="en")
    max_speakers: Mapped[int] = mapped_column(Integer, default=5)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    transcripts: Mapped[list["Transcript"]] = relationship("Transcript", back_populates="session")
    notes: Mapped[list["Note"]] = relationship("Note", back_populates="session")


class Transcript(Base):
    __tablename__ = "transcripts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), nullable=False)
    speaker_id: Mapped[int | None] = mapped_column(ForeignKey("speakers.id"), nullable=True)
    speaker_label: Mapped[str] = mapped_column(String, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    start: Mapped[float] = mapped_column(Float, nullable=False)
    end: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    session: Mapped["Session"] = relationship("Session", back_populates="transcripts")
    speaker: Mapped["Speaker | None"] = relationship("Speaker", back_populates="transcripts")


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    generated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    session: Mapped["Session"] = relationship("Session", back_populates="notes")