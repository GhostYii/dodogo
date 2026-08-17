// 后端 API DTO 类型（与 models.rs / api-contract.md 对应）

export interface LabelDto {
  id: number;
  name: string;
  color: string;
}

export interface AssigneeDto {
  id: number;
  username: string;
  displayName: string;
  avatarPath: string | null;
}

export interface MemberDto {
  userId: number;
  username: string;
  displayName: string;
  avatarPath: string | null;
  role: string;
  joinedAt: string;
}

export interface CardSummary {
  id: number;
  no: number;
  number: string;
  title: string;
  columnId: number;
  position: number;
  priority: string;
  assignee: AssigneeDto | null;
  labelIds: number[];
  milestoneId: number | null;
  versionId: number | null;
  dueDate: string | null;
  checklistDone: number;
  checklistTotal: number;
  updatedAt: string;
}

export interface BoardDto {
  id: number;
  name: string;
  color: string;
  position: number;
  status: string;
}

export interface ColumnDto {
  id: number;
  name: string;
  position: number;
  color: string;
  wipLimit: number;
  isDone: boolean;
}

export interface BoardFull {
  board: BoardDto;
  columns: ColumnDto[];
  cards: CardSummary[];
  labels: LabelDto[];
  members: AssigneeDto[];
}

export interface CommentDto {
  id: number;
  userId: number;
  username: string;
  displayName: string;
  avatarPath: string | null;
  contentHtml: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistItemDto {
  id: number;
  title: string;
  done: boolean;
}

export interface ChecklistDto {
  id: number;
  title: string;
  items: ChecklistItemDto[];
}

export interface AttachmentDto {
  id: number;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploaderId: number;
  uploaderName: string;
  createdAt: string;
}

export interface ActivityDto {
  id: number;
  userId: number | null;
  username: string | null;
  displayName: string | null;
  action: string;
  detail: string;
  createdAt: string;
}

export interface GitCommitDto {
  id: number;
  shortSha: string;
  authorName: string;
  message: string;
  committedAt: string | null;
  commitUrl: string;
  mrUrl: string;
}

export interface MilestoneDto {
  id: number;
  name: string;
  description: string;
  startDate: string | null;
  dueDate: string | null;
  status: string;
  color: string;
  totalCards: number;
  doneCards: number;
  percent: number;
}

export interface VersionDto {
  id: number;
  name: string;
  description: string;
  releaseDate: string | null;
  status: string;
  totalCards: number;
  doneCards: number;
  percent: number;
}

export interface CardDetail {
  id: number;
  no: number;
  number: string;
  title: string;
  description: string;
  descriptionHtml: string;
  columnId: number;
  columnName: string;
  boardId: number;
  priority: string;
  assignee: AssigneeDto | null;
  labels: LabelDto[];
  startDate: string | null;
  dueDate: string | null;
  estimateHours: number | null;
  milestone: MilestoneDto | null;
  version: VersionDto | null;
  status: string;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  comments: CommentDto[];
  checklists: ChecklistDto[];
  attachments: AttachmentDto[];
  activities: ActivityDto[];
  gitCommits: GitCommitDto[];
}

export interface ProjectDto {
  id: number;
  key: string;
  name: string;
  description: string;
  iconColor: string;
  ownerId: number;
  status: string;
  role: string | null;
  createdAt: string;
}

export interface NotificationDto {
  id: number;
  type: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string;
}

export interface SearchItem {
  id: number;
  no: number;
  number: string;
  title: string;
  projectKey: string;
  projectName: string;
  boardName?: string;
  columnName?: string;
  updatedAt?: string;
}

export interface Me {
  id: number;
  username: string;
  displayName: string;
  avatarPath: string | null;
  role: string;
  email?: string;
}
