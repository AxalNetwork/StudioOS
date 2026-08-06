import os
from sqlmodel import SQLModel, create_engine, Session


def get_engine():
    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        raise RuntimeError("DATABASE_URL environment variable is not set")
    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)
    return create_engine(database_url, echo=False)


def get_session():
    engine = get_engine()
    with Session(engine) as session:
        yield session


def init_db():
    engine = get_engine()
    SQLModel.metadata.create_all(engine)
