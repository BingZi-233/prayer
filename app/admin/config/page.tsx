"use client"

import {
  Save,
  Cable,
  MessageSquareText,
  Brain,
  Settings2,
  Wrench,
} from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { PageShell } from "@/components/admin/page-shell"
import { PageHeader } from "@/components/admin/page-header"
import { ErrorState } from "@/components/admin/data-state"

import { useConfigForm } from "@/components/admin/config/use-config-form"
import { QqSettings } from "@/components/admin/config/qq-settings"
import { TgSettings } from "@/components/admin/config/tg-settings"
import { AdminSettings } from "@/components/admin/config/admin-settings"
import { ReplySettings } from "@/components/admin/config/reply-settings"
import { SdkSettings } from "@/components/admin/config/sdk-settings"
import { SessionSettings } from "@/components/admin/config/session-settings"
import { KnowledgePrefetchSettings } from "@/components/admin/config/knowledge-settings"
import { ReflectSettings } from "@/components/admin/config/reflect-settings"
import { ProactiveSettings } from "@/components/admin/config/proactive-settings"
import { NotifySettings } from "@/components/admin/config/notify-settings"
import { StorageSettings } from "@/components/admin/config/storage-settings"
import { BrandSettings } from "@/components/admin/config/brand-settings"

function CategoryHeader({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

export default function ConfigPage() {
  const {
    cfg,
    setCfg,
    updateField,
    fieldValue,
    groups,
    groupsLoading,
    admins,
    adminsLoading,
    enabledQqIds,
    enabledTgIds,
    adminQq,
    toggleGroup,
    adminLabel,
    toggleExtraAt,
    groupName,
    tgChatDraft,
    setTgChatDraft,
    addTgChat,
    removeTgChat,
    tgTokenConfigured,
    tgBypassWarn,
    tgChannel,
    tgChatTitle,
    setAdminChannel,
    setAdminChatId,
    adminGroupOptions,
    adminTgOptions,
    busy,
    save,
    error,
    reload,
  } = useConfigForm()

  return (
    <PageShell>
      <PageHeader
        title="配置"
        description="按用途整理品牌、渠道、对话策略与系统参数。修改后保存即生效。"
        actions={
          <Button onClick={save} disabled={busy || !cfg}>
            {busy ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Save data-icon="inline-start" />
            )}
            {busy ? "保存中…" : "保存并生效"}
          </Button>
        }
      />

      {error && <ErrorState description={error} onRetry={reload} />}
      {!cfg && !error && <Skeleton className="h-72 w-full" />}

      {cfg && (
        <Tabs
          defaultValue="base"
          orientation="vertical"
          className="grid min-w-0 gap-3 md:grid-cols-[220px_minmax(0,1fr)] md:items-start md:gap-4"
        >
          <div className="h-fit md:sticky md:top-20">
            <div className="mb-1 px-2 pt-1 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground">
              设置分类
            </div>
            <TabsList
              variant="line"
              aria-label="设置分类"
              className="grid h-fit w-full grid-cols-2 content-start gap-1 rounded-lg border bg-muted/30 p-2 md:grid-cols-1 md:rounded-lg md:border-0 md:bg-muted/40 md:p-1"
            >
              <TabsTrigger
                value="base"
                className="h-auto min-h-10 justify-start gap-2 px-3 py-2 text-left"
              >
                <Settings2 data-icon="inline-start" />
                <span className="min-w-0">
                  <span className="block">基础与管理</span>
                  <span className="hidden text-[11px] font-normal text-muted-foreground md:block">
                    品牌与管理命令
                  </span>
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="channels"
                className="h-auto min-h-10 justify-start gap-2 px-3 py-2 text-left"
              >
                <Cable data-icon="inline-start" />
                <span className="min-w-0">
                  <span className="block">渠道接入</span>
                  <span className="hidden text-[11px] font-normal text-muted-foreground md:block">
                    QQ 与 Telegram
                  </span>
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="conversation"
                className="h-auto min-h-10 justify-start gap-2 px-3 py-2 text-left"
              >
                <MessageSquareText data-icon="inline-start" />
                <span className="min-w-0">
                  <span className="block">对话与自动化</span>
                  <span className="hidden text-[11px] font-normal text-muted-foreground md:block">
                    回复、会话、主动补位
                  </span>
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="knowledge"
                className="h-auto min-h-10 justify-start gap-2 px-3 py-2 text-left"
              >
                <Brain data-icon="inline-start" />
                <span className="min-w-0">
                  <span className="block">知识与通知</span>
                  <span className="hidden text-[11px] font-normal text-muted-foreground md:block">
                    预检索、反思与提醒
                  </span>
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="advanced"
                className="h-auto min-h-10 justify-start gap-2 px-3 py-2 text-left"
              >
                <Wrench data-icon="inline-start" />
                <span className="min-w-0">
                  <span className="block">系统高级</span>
                  <span className="hidden text-[11px] font-normal text-muted-foreground md:block">
                    SDK 与存储路径
                  </span>
                </span>
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="min-w-0">
            <TabsContent value="base" className="m-0 flex flex-col gap-4">
              <CategoryHeader
                title="基础与管理"
                description="先确认对外身份，再设置管理命令和转人工的接收位置。"
              />
              <BrandSettings cfg={cfg} updateField={updateField} embedded />
              <AdminSettings
                cfg={cfg}
                updateField={updateField}
                fieldValue={fieldValue}
                groups={groups}
                groupsLoading={groupsLoading}
                adminQq={adminQq}
                setAdminChannel={setAdminChannel}
                setAdminChatId={setAdminChatId}
                adminGroupOptions={adminGroupOptions}
                adminTgOptions={adminTgOptions}
                embedded
              />
            </TabsContent>

            <TabsContent value="channels" className="m-0 flex flex-col gap-4">
              <CategoryHeader
                title="渠道接入"
                description="配置消息通道和生效会话；未配置凭证的通道不会启动。"
              />
              <QqSettings
                cfg={cfg}
                updateField={updateField}
                fieldValue={fieldValue}
                groups={groups}
                groupsLoading={groupsLoading}
                admins={admins}
                adminsLoading={adminsLoading}
                enabledQqIds={enabledQqIds}
                adminQq={adminQq}
                toggleGroup={toggleGroup}
                adminLabel={adminLabel}
                toggleExtraAt={toggleExtraAt}
                groupName={groupName}
                embedded
              />
              <TgSettings
                cfg={cfg}
                setCfg={setCfg}
                enabledTgIds={enabledTgIds}
                tgChatDraft={tgChatDraft}
                setTgChatDraft={setTgChatDraft}
                addTgChat={addTgChat}
                removeTgChat={removeTgChat}
                tgTokenConfigured={tgTokenConfigured}
                tgBypassWarn={tgBypassWarn}
                tgChannel={tgChannel}
                tgChatTitle={tgChatTitle}
                embedded
              />
            </TabsContent>

            <TabsContent value="conversation" className="m-0 flex flex-col gap-4">
              <CategoryHeader
                title="对话与自动化"
                description="调整回复呈现、会话生命周期和无人应答时的主动补位策略。"
              />
              <ReplySettings
                cfg={cfg}
                setCfg={setCfg}
                updateField={updateField}
                fieldValue={fieldValue}
                embedded
              />
              <SessionSettings cfg={cfg} setCfg={setCfg} embedded />
              <ProactiveSettings
                cfg={cfg}
                setCfg={setCfg}
                updateField={updateField}
                fieldValue={fieldValue}
                embedded
              />
            </TabsContent>

            <TabsContent value="knowledge" className="m-0 flex flex-col gap-4">
              <CategoryHeader
                title="知识与通知"
                description="管理知识沉淀节奏，并决定是否向管理面发送相关运行提醒。"
              />
              <KnowledgePrefetchSettings
                cfg={cfg}
                setCfg={setCfg}
                updateField={updateField}
                fieldValue={fieldValue}
                embedded
              />
              <ReflectSettings
                cfg={cfg}
                setCfg={setCfg}
                updateField={updateField}
                fieldValue={fieldValue}
                embedded
              />
              <NotifySettings cfg={cfg} setCfg={setCfg} embedded />
            </TabsContent>

            <TabsContent value="advanced" className="m-0 flex flex-col gap-4">
              <CategoryHeader
                title="系统高级"
                description="仅在需要调整运行目录或数据库位置时修改这些参数。"
              />
              <SdkSettings cfg={cfg} updateField={updateField} embedded />
              <StorageSettings cfg={cfg} updateField={updateField} embedded />
            </TabsContent>
          </div>
        </Tabs>
      )}
    </PageShell>
  )
}
